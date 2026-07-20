package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"

	"mappening/internal/config"
	"mappening/internal/contracts"
	"mappening/internal/geocoding"
	"mappening/internal/http/middleware"
	"mappening/internal/httpx"
	"mappening/internal/mailer"
	"mappening/internal/users"
)

// Handler regroupe les dependances HTTP necessaires aux endpoints d'authentification.
type Handler struct {
	Secret           string
	Issuer           string
	AccessTTL        time.Duration
	RefreshTTL       time.Duration
	CookieSecure     bool
	CSRFCookieDomain string
	Env              string
	FrontendURL      string

	DevLoginEnabled bool
	DevLoginEmail   string

	Store    RefreshTokenStore
	Service  authUserReader
	Geocoder geocoding.Normalizer
	Mailer   mailer.Sender
}

const dummyPasswordHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

// authUserReader definit la lecture d'un utilisateur par email.
type authUserReader interface {
	GetByEmail(ctx context.Context, email string) (*users.User, error)
}

// authUserCreator definit la creation d'un compte utilisateur.
type authUserCreator interface {
	Create(ctx context.Context, user *users.User) (int64, error)
}

// authUserAuthenticator definit la verification des identifiants utilisateur.
type authUserAuthenticator interface {
	Login(ctx context.Context, email, password string) (*users.User, error)
}

// authOrganizationCreator definit la creation d'un compte organisation.
type authOrganizationCreator interface {
	CreateOrganization(ctx context.Context, registration users.OrganizationRegistration) (*users.User, int64, error)
}

// authUserRegistrar definit le parcours complet d'inscription utilisateur.
type authUserRegistrar interface {
	RegisterUser(ctx context.Context, req contracts.RegisterUserRequestDTO) (*users.User, error)
}

// authOrganizationRegistrar definit le parcours complet d'inscription organisation.
type authOrganizationRegistrar interface {
	RegisterOrganization(ctx context.Context, req contracts.RegisterOrganizationRequestDTO, normalizedAddress normalizedOrganizationAddress) (*users.User, int64, error)
}

// authUserPasswordUpdater definit la mise a jour du mot de passe.
type authUserPasswordUpdater interface {
	UpdatePassword(ctx context.Context, userID int64, passwordHash string) error
}

// authUserProfileUpdater definit la mise a jour directe du profil utilisateur.
type authUserProfileUpdater interface {
	UpdateProfile(ctx context.Context, accountID int64, email string, username string) (*users.User, error)
}

// authPasswordResetter definit les operations bas niveau de reset de mot de passe.
type authPasswordResetter interface {
	CreatePasswordResetToken(ctx context.Context, email string, token string, expiresAt time.Time) (bool, error)
	ResetPasswordWithToken(ctx context.Context, token string, passwordHash string) error
}

// authProfileRequestUpdater definit la mise a jour de profil depuis un DTO HTTP.
type authProfileRequestUpdater interface {
	UpdateProfileFromRequest(ctx context.Context, accountID int64, req contracts.UpdateProfileRequestDTO) (*users.User, error)
}

// authPasswordResetService definit le parcours applicatif de reset de mot de passe.
type authPasswordResetService interface {
	RequestPasswordReset(ctx context.Context, req contracts.ForgotPasswordRequestDTO) (*PasswordResetRequest, error)
	ResetPassword(ctx context.Context, req contracts.ResetPasswordRequestDTO) error
}

// authPasswordChanger definit le changement de mot de passe d'un utilisateur connecte.
type authPasswordChanger interface {
	ChangePassword(ctx context.Context, email string, req contracts.ChangePasswordRequestDTO) (*users.User, error)
}

// authUserPreferencesService definit la lecture et le remplacement des preferences.
type authUserPreferencesService interface {
	ListEventPreferences(ctx context.Context, accountID int64) ([]users.EventPreference, error)
	ReplaceEventPreferences(ctx context.Context, accountID int64, categorySlugs []string) ([]users.EventPreference, error)
}

// authUserNotificationsService definit les operations de notifications utilisateur.
type authUserNotificationsService interface {
	ListNotificationTypes(ctx context.Context) ([]users.NotificationType, error)
	ListNotifications(ctx context.Context, accountID int64) ([]users.Notification, error)
	MarkNotificationRead(ctx context.Context, accountID int64, notificationID int64) (*users.Notification, error)
	MarkAllNotificationsRead(ctx context.Context, accountID int64) error
}

// authUserDeleter definit la desactivation ou suppression d'un compte.
type authUserDeleter interface {
	Deactivate(ctx context.Context, userID int64) error
	Delete(ctx context.Context, userID int64) error
}

// Login authentifie un utilisateur et demarre une session avec cookies.
func (h Handler) Login(w http.ResponseWriter, r *http.Request) {
	authenticator, ok := h.Service.(authUserAuthenticator)
	if h.Service == nil || h.Store == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	if !isJSONContentType(r.Header.Get("Content-Type")) {
		httpx.WriteJSONError(w, http.StatusUnsupportedMediaType, "content type must be application/json")
		return
	}

	if !isAllowedBrowserOrigin(r, h.FrontendURL) {
		httpx.WriteJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}

	var req contracts.LoginRequestDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		log.Error().
			Err(err).
			Msg("login: invalid request body")

		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	if req.Email == "" || strings.TrimSpace(req.Password) == "" {
		httpx.WriteJSONError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	if len(req.Email) > 254 || len(req.Password) > 4096 {
		httpx.WriteJSONError(w, http.StatusBadRequest, "request fields are too large")
		return
	}

	user, err := authenticator.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		if errors.Is(err, users.ErrUserNotFound) {
			_ = bcrypt.CompareHashAndPassword([]byte(dummyPasswordHash), []byte(req.Password))
			log.Warn().
				Str("email", req.Email).
				Msg("login failed: invalid credentials")

			httpx.WriteJSONError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		if errors.Is(err, ErrInvalidCredentials) || errors.Is(err, ErrUserInactive) {
			log.Warn().
				Str("email", req.Email).
				Msg("login failed: invalid credentials")

			httpx.WriteJSONError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}

		log.Error().
			Err(err).
			Str("email", req.Email).
			Msg("login failed: repository error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	csrf, ok := h.startSession(w, user, "login failed")
	if !ok {
		return
	}

	log.Info().
		Str("email", user.Email).
		Str("role", user.Role).
		Msg("login success")

	writeLoginResponse(w, user, csrf)
}

// RegisterUser cree un compte utilisateur puis ouvre une session.
func (h Handler) RegisterUser(w http.ResponseWriter, r *http.Request) {
	registrar, ok := h.Service.(authUserRegistrar)
	if h.Service == nil || h.Store == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	if !isJSONContentType(r.Header.Get("Content-Type")) {
		httpx.WriteJSONError(w, http.StatusUnsupportedMediaType, "content type must be application/json")
		return
	}
	if !isAllowedBrowserOrigin(r, h.FrontendURL) {
		httpx.WriteJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}

	var req contracts.RegisterUserRequestDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	user, err := registrar.RegisterUser(r.Context(), req)
	if err != nil {
		writeAuthServiceError(w, err)
		return
	}

	csrf, ok := h.startSession(w, user, "register user failed")
	if !ok {
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, contracts.LoginResponseDTO{
		OK:        true,
		User:      toAuthUserDTO(user),
		CSRFToken: csrf,
	})
	h.sendWelcomeEmail(r.Context(), user.Email, user.FirstName, false)
}

// RegisterOrganization cree un compte organisation puis ouvre une session.
func (h Handler) RegisterOrganization(w http.ResponseWriter, r *http.Request) {
	registrar, ok := h.Service.(authOrganizationRegistrar)
	if h.Service == nil || h.Store == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	if !isJSONContentType(r.Header.Get("Content-Type")) {
		httpx.WriteJSONError(w, http.StatusUnsupportedMediaType, "content type must be application/json")
		return
	}
	if !isAllowedBrowserOrigin(r, h.FrontendURL) {
		httpx.WriteJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}

	var req contracts.RegisterOrganizationRequestDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	normalizedAddress, err := h.normalizeOrganizationAddress(r, req)
	if err != nil {
		writeGeocodingError(w, err)
		return
	}

	user, organizationID, err := registrar.RegisterOrganization(r.Context(), req, normalizedAddress)
	if err != nil {
		writeAuthServiceError(w, err)
		return
	}

	csrf, ok := h.startSession(w, user, "register organization failed")
	if !ok {
		return
	}

	dto := toAuthUserDTO(user)
	dto.OrganizationID = &organizationID
	httpx.WriteJSON(w, http.StatusCreated, contracts.LoginResponseDTO{
		OK:        true,
		User:      dto,
		CSRFToken: csrf,
	})
	h.sendWelcomeEmail(r.Context(), user.Email, user.FirstName, true)
}

// normalizedOrganizationAddress contient l'adresse organisation normalisee.
type normalizedOrganizationAddress struct {
	address    string
	city       string
	postalCode string
	latitude   *float64
	longitude  *float64
}

// normalizeOrganizationAddress enrichit l'adresse organisation avec le geocodage.
func (h Handler) normalizeOrganizationAddress(
	r *http.Request,
	req contracts.RegisterOrganizationRequestDTO,
) (normalizedOrganizationAddress, error) {
	fallback := normalizedOrganizationAddress{
		address:    strings.TrimSpace(req.Address),
		city:       strings.TrimSpace(req.City),
		postalCode: strings.TrimSpace(req.PostalCode),
	}
	if h.Geocoder == nil {
		return fallback, nil
	}

	normalized, err := h.Geocoder.Normalize(r.Context(), geocoding.Address{
		Street:     req.Address,
		City:       req.City,
		PostalCode: req.PostalCode,
	})
	if err != nil {
		return fallback, err
	}

	return normalizedOrganizationAddress{
		address:    normalized.Address,
		city:       normalized.City,
		postalCode: normalized.PostalCode,
		latitude:   &normalized.Latitude,
		longitude:  &normalized.Longitude,
	}, nil
}

// DevLogin connecte rapidement le compte de developpement autorise.
func (h Handler) DevLogin(w http.ResponseWriter, r *http.Request) {
	if !h.DevLoginEnabled || !config.IsDevLikeEnv(h.Env) {
		http.NotFound(w, r)
		return
	}

	if h.Service == nil || h.Store == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	if !isLoopbackRequest(r) {
		httpx.WriteJSONError(w, http.StatusForbidden, "local dev login is only available from loopback")
		return
	}
	if !isLoopbackRequestHost(r) {
		httpx.WriteJSONError(w, http.StatusForbidden, "local dev login is only available on a loopback host")
		return
	}

	if !isAllowedBrowserOrigin(r, h.FrontendURL) {
		httpx.WriteJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}

	email := strings.TrimSpace(strings.ToLower(h.DevLoginEmail))
	if email == "" {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "dev login is not configured")
		return
	}

	user, err := h.Service.GetByEmail(r.Context(), email)
	if err != nil {
		if errors.Is(err, users.ErrUserNotFound) {
			httpx.WriteJSONError(w, http.StatusUnauthorized, "dev login user not found")
			return
		}

		log.Error().
			Err(err).
			Str("email", email).
			Msg("dev login failed: repository error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if !isUserAllowedToAuthenticate(user) {
		httpx.WriteJSONError(w, http.StatusForbidden, "user inactive")
		return
	}

	csrf, ok := h.startSession(w, user, "dev login failed")
	if !ok {
		return
	}

	log.Info().
		Str("email", user.Email).
		Str("role", user.Role).
		Msg("dev login success")

	writeLoginResponse(w, user, csrf)
}

// Refresh renouvelle les tokens depuis le refresh token valide.
func (h Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	if h.Service == nil || h.Store == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	if !isAllowedBrowserOrigin(r, h.FrontendURL) {
		httpx.WriteJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}

	c, err := r.Cookie("refresh_token")
	if err != nil || c.Value == "" {
		log.Warn().Msg("refresh failed: missing refresh token")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "missing refresh token")
		return
	}

	claims := &middleware.UserClaims{}
	token, err := jwt.ParseWithClaims(c.Value, claims, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return []byte(h.Secret), nil
	})

	if err != nil || !token.Valid {
		log.Warn().Msg("refresh failed: invalid refresh token")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	if claims.Subject == "" || claims.Issuer != h.Issuer {
		log.Warn().Msg("refresh failed: invalid token claims")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	if !hasAudience(claims.Audience, "refresh") {
		log.Warn().Msg("refresh failed: invalid token audience")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	if claims.ID == "" {
		log.Warn().Msg("refresh failed: missing token id")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	current, ok, err := h.Store.Get(claims.Subject)
	if err != nil {
		log.Error().
			Err(err).
			Str("email", claims.Subject).
			Msg("refresh failed: refresh store error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if !ok || current != claims.ID {
		log.Warn().
			Str("email", claims.Subject).
			Msg("refresh failed: token revoked")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "refresh token revoked")
		return
	}

	user, err := h.Service.GetByEmail(r.Context(), claims.Subject)
	if err != nil {
		if errors.Is(err, users.ErrUserNotFound) {
			log.Warn().
				Str("email", claims.Subject).
				Msg("refresh failed: user not found")

			httpx.WriteJSONError(w, http.StatusUnauthorized, "user not found")
			return
		}

		log.Error().
			Err(err).
			Str("email", claims.Subject).
			Msg("refresh failed: repository error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if !isUserAllowedToAuthenticate(user) {
		log.Warn().
			Str("email", user.Email).
			Msg("refresh failed: user inactive")

		httpx.WriteJSONError(w, http.StatusForbidden, "user inactive")
		return
	}
	if !refreshClaimsMatchCurrentUser(user, claims) {
		log.Warn().
			Str("email", user.Email).
			Msg("refresh failed: stale user state")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "refresh token revoked")
		return
	}

	access, accessExp, refresh, refreshExp, newJTI, err := h.issueTokens(user)
	if err != nil {
		log.Error().
			Err(err).
			Str("email", user.Email).
			Msg("refresh failed: token generation error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "token error")
		return
	}

	rotated, err := h.Store.CompareAndSwapWithExpiry(user.Email, claims.ID, newJTI, refreshExp)
	if err != nil {
		log.Error().
			Err(err).
			Str("email", user.Email).
			Msg("refresh failed: refresh store compare-and-swap error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "token error")
		return
	}
	if !rotated {
		log.Warn().
			Str("email", user.Email).
			Msg("refresh failed: token rotation lost race")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "refresh token revoked")
		return
	}

	csrf, err := randomHex(32)
	if err != nil {
		log.Error().
			Err(err).
			Str("email", user.Email).
			Msg("refresh failed: csrf generation error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "token error")
		return
	}
	setCsrfCookie(w, csrf, refreshExp, CookieOpts{Secure: h.CookieSecure, CSRFCookieDomain: h.CSRFCookieDomain})
	setAuthCookies(w, access, accessExp, refresh, refreshExp, CookieOpts{Secure: h.CookieSecure})
	writeCSRFHeader(w, csrf)

	log.Info().
		Str("email", user.Email).
		Msg("refresh success")

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "csrf_token": csrf})
}

// Logout supprime le refresh token et nettoie les cookies d'authentification.
func (h Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	if u := middleware.GetUser(r); u != nil {
		if err := h.Store.Delete(u.Email); err != nil {
			log.Error().
				Err(err).
				Str("email", u.Email).
				Msg("logout failed: refresh store error")

			httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
			return
		}

		log.Info().
			Str("email", u.Email).
			Msg("logout success")
	} else {
		log.Warn().Msg("logout: no authenticated user in context")
	}

	clearAuthCookies(w, CookieOpts{Secure: h.CookieSecure, CSRFCookieDomain: h.CSRFCookieDomain})

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Me retourne les informations du compte actuellement authentifie.
func (h Handler) Me(w http.ResponseWriter, r *http.Request) {
	if h.Service == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		log.Warn().Msg("me failed: no user in context")

		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}

	user, err := h.Service.GetByEmail(r.Context(), claimsUser.Email)
	if err != nil {
		if errors.Is(err, users.ErrUserNotFound) {
			log.Warn().
				Str("email", claimsUser.Email).
				Msg("me failed: user not found")

			httpx.WriteJSONError(w, http.StatusUnauthorized, "user not found")
			return
		}

		log.Error().
			Err(err).
			Str("email", claimsUser.Email).
			Msg("me failed: repository error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if !isUserAllowedToAuthenticate(user) {
		log.Warn().
			Str("email", user.Email).
			Msg("me failed: user inactive")

		httpx.WriteJSONError(w, http.StatusForbidden, "user inactive")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toAuthUserDTO(user))
}

// UpdateProfile met a jour l'email et le nom utilisateur du compte courant.
func (h Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	updater, ok := h.Service.(authProfileRequestUpdater)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}

	var req contracts.UpdateProfileRequestDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	user, err := updater.UpdateProfileFromRequest(r.Context(), claimsUser.UserID, req)
	if err != nil {
		writeAuthServiceError(w, err)
		return
	}
	if h.Store != nil && !strings.EqualFold(claimsUser.Email, user.Email) {
		_ = h.Store.Delete(claimsUser.Email)
	}

	httpx.WriteJSON(w, http.StatusOK, toAuthUserDTO(user))
}

// ForgotPassword genere une demande de reinitialisation de mot de passe.
func (h Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	resetter, ok := h.Service.(authPasswordResetService)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}
	if !isJSONContentType(r.Header.Get("Content-Type")) {
		httpx.WriteJSONError(w, http.StatusUnsupportedMediaType, "content type must be application/json")
		return
	}
	if !isAllowedBrowserOrigin(r, h.FrontendURL) {
		httpx.WriteJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}

	var req contracts.ForgotPasswordRequestDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	resetRequest, err := resetter.RequestPasswordReset(r.Context(), req)
	if err != nil {
		writeAuthServiceError(w, err)
		return
	}

	message := "Si un compte actif existe avec cet email, un lien de reinitialisation a ete envoye."
	response := contracts.ForgotPasswordResponseDTO{OK: true, Message: message}
	if resetRequest.Exists {
		resetPath := "/reset-password/" + resetRequest.Token
		if h.FrontendURL != "" {
			if base, err := url.Parse(h.FrontendURL); err == nil {
				base.Path = resetPath
				base.RawQuery = ""
				base.Fragment = ""
				response.ResetURL = base.String()
				response.ResetLink = response.ResetURL
			}
		}
		if response.ResetURL == "" {
			response.ResetURL = resetPath
			response.ResetLink = resetPath
		}
		h.sendPasswordResetEmail(r.Context(), resetRequest.Email, response.ResetURL)
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

// ResetPassword applique un nouveau mot de passe depuis un token valide.
func (h Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	resetter, ok := h.Service.(authPasswordResetService)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}
	if !isJSONContentType(r.Header.Get("Content-Type")) {
		httpx.WriteJSONError(w, http.StatusUnsupportedMediaType, "content type must be application/json")
		return
	}
	if !isAllowedBrowserOrigin(r, h.FrontendURL) {
		httpx.WriteJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}

	var req contracts.ResetPasswordRequestDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := resetter.ResetPassword(r.Context(), req); err != nil {
		if errors.Is(err, users.ErrUserNotFound) {
			httpx.WriteJSONError(w, http.StatusBadRequest, "invalid or expired reset token")
			return
		}
		writeAuthServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// sendPasswordResetEmail prepare l'email de reinitialisation de mot de passe.
func (h Handler) sendPasswordResetEmail(ctx context.Context, email string, resetURL string) {
	h.sendMail(ctx, mailer.Message{
		To:      email,
		Subject: "Reinitialisation de votre mot de passe Mappening",
		Text: strings.Join([]string{
			"Bonjour,",
			"",
			"Une demande de reinitialisation de mot de passe a ete faite pour votre compte Mappening.",
			"Vous pouvez choisir un nouveau mot de passe avec ce lien :",
			resetURL,
			"",
			"Si vous n'etes pas a l'origine de cette demande, ignorez ce message.",
		}, "\n"),
	}, "password reset")
}

// sendWelcomeEmail prepare l'email de bienvenue apres inscription.
func (h Handler) sendWelcomeEmail(ctx context.Context, email string, name string, organization bool) {
	greeting := "Bonjour,"
	if trimmedName := strings.TrimSpace(name); trimmedName != "" {
		greeting = "Bonjour " + trimmedName + ","
	}
	lines := []string{
		greeting,
		"",
		"Bienvenue sur Mappening.",
		"Votre compte est maintenant cree.",
	}
	if organization {
		lines = append(lines, "", "Votre espace organisation sera visible apres validation par l'equipe de moderation.")
	}

	h.sendMail(ctx, mailer.Message{
		To:      email,
		Subject: "Bienvenue sur Mappening",
		Text:    strings.Join(lines, "\n"),
	}, "welcome")
}

// sendMail envoie un email en arriere-plan si un mailer est configure.
func (h Handler) sendMail(_ context.Context, message mailer.Message, purpose string) {
	if h.Mailer == nil {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := h.Mailer.Send(ctx, message); err != nil {
			log.Error().
				Err(err).
				Str("to", message.To).
				Str("purpose", purpose).
				Msg("mail delivery failed")
		}
	}()
}

// ListPreferences retourne les preferences evenementielles du compte courant.
func (h Handler) ListPreferences(w http.ResponseWriter, r *http.Request) {
	service, ok := h.Service.(authUserPreferencesService)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}
	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}
	preferences, err := service.ListEventPreferences(r.Context(), claimsUser.UserID)
	if err != nil {
		writeAuthMutationError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, preferences)
}

// ReplacePreferences remplace les preferences evenementielles du compte courant.
func (h Handler) ReplacePreferences(w http.ResponseWriter, r *http.Request) {
	service, ok := h.Service.(authUserPreferencesService)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}
	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}
	var req contracts.ReplacePreferencesRequestDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.CategorySlugs) == 0 {
		httpx.WriteJSONError(w, http.StatusBadRequest, "at least one preference is required")
		return
	}
	preferences, err := service.ReplaceEventPreferences(r.Context(), claimsUser.UserID, req.CategorySlugs)
	if err != nil {
		writeAuthMutationError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, preferences)
}

// ListNotifications retourne les notifications du compte courant.
func (h Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	service, ok := h.Service.(authUserNotificationsService)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}
	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}
	notifications, err := service.ListNotifications(r.Context(), claimsUser.UserID)
	if err != nil {
		writeAuthMutationError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, notifications)
}

// ListNotificationTypes retourne les types de notifications disponibles.
func (h Handler) ListNotificationTypes(w http.ResponseWriter, r *http.Request) {
	service, ok := h.Service.(authUserNotificationsService)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}
	types, err := service.ListNotificationTypes(r.Context())
	if err != nil {
		writeAuthMutationError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, types)
}

// MarkNotificationRead marque une notification comme lue.
func (h Handler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	service, ok := h.Service.(authUserNotificationsService)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}
	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}
	notificationID, err := parseTrailingID(r.URL.Path, "/read")
	if err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, "invalid notification id")
		return
	}
	notification, err := service.MarkNotificationRead(r.Context(), claimsUser.UserID, notificationID)
	if err != nil {
		writeAuthMutationError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, notification)
}

// MarkAllNotificationsRead marque toutes les notifications comme lues.
func (h Handler) MarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	service, ok := h.Service.(authUserNotificationsService)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}
	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}
	if err := service.MarkAllNotificationsRead(r.Context(), claimsUser.UserID); err != nil {
		writeAuthMutationError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ChangePassword change le mot de passe du compte courant et ferme la session.
func (h Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	changer, ok := h.Service.(authPasswordChanger)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}

	var req contracts.ChangePasswordRequestDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	user, err := changer.ChangePassword(r.Context(), claimsUser.Email, req)
	if err != nil {
		if errors.Is(err, users.ErrUserNotFound) {
			httpx.WriteJSONError(w, http.StatusUnauthorized, "user not found")
			return
		}
		if errors.Is(err, ErrInvalidCredentials) {
			httpx.WriteJSONError(w, http.StatusUnauthorized, "invalid password")
			return
		}
		writeAuthServiceError(w, err)
		return
	}
	if h.Store != nil {
		_ = h.Store.Delete(user.Email)
	}
	clearAuthCookies(w, CookieOpts{Secure: h.CookieSecure, CSRFCookieDomain: h.CSRFCookieDomain})

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// CheckRole verifie si le role courant correspond au role demande.
func (h Handler) CheckRole(w http.ResponseWriter, r *http.Request) {
	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}

	expected := strings.TrimSpace(strings.ToLower(strings.TrimPrefix(r.URL.Path, "/api/auth/check-role/")))
	actual := strings.TrimSpace(strings.ToLower(claimsUser.Role))
	httpx.WriteJSON(w, http.StatusOK, contracts.AuthCheckResponseDTO{
		OK:      true,
		Allowed: expected != "" && actual == expected,
		Actual:  actual,
	})
}

// CheckAccountType verifie si le type de compte courant correspond au type demande.
func (h Handler) CheckAccountType(w http.ResponseWriter, r *http.Request) {
	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}

	user, err := h.Service.GetByEmail(r.Context(), claimsUser.Email)
	if err != nil {
		if errors.Is(err, users.ErrUserNotFound) {
			httpx.WriteJSONError(w, http.StatusUnauthorized, "user not found")
			return
		}
		log.Error().Err(err).Msg("check account type: get user failed")
		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	expected := strings.TrimSpace(strings.ToLower(strings.TrimPrefix(r.URL.Path, "/api/auth/check-account-type/")))
	actual := strings.TrimSpace(strings.ToLower(user.AccountType))
	httpx.WriteJSON(w, http.StatusOK, contracts.AuthCheckResponseDTO{
		OK:      true,
		Allowed: expected != "" && actual == expected,
		Actual:  actual,
	})
}

// DeactivateAccount desactive le compte courant.
func (h Handler) DeactivateAccount(w http.ResponseWriter, r *http.Request) {
	h.closeOwnAccount(w, r, false)
}

// DeleteAccount supprime le compte courant.
func (h Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	h.closeOwnAccount(w, r, true)
}

// closeOwnAccount factorise la fermeture logique ou definitive du compte courant.
func (h Handler) closeOwnAccount(w http.ResponseWriter, r *http.Request, delete bool) {
	deleter, ok := h.Service.(authUserDeleter)
	if h.Service == nil || !ok {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "auth service not configured")
		return
	}

	claimsUser := middleware.GetUser(r)
	if claimsUser == nil {
		httpx.WriteJSONError(w, http.StatusUnauthorized, "no user")
		return
	}
	if claimsUser.Role == "admin" {
		httpx.WriteJSONError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	var err error
	if delete {
		err = deleter.Delete(r.Context(), claimsUser.UserID)
	} else {
		err = deleter.Deactivate(r.Context(), claimsUser.UserID)
	}
	if err != nil {
		writeAuthMutationError(w, err)
		return
	}

	if h.Store != nil {
		_ = h.Store.Delete(claimsUser.Email)
	}
	clearAuthCookies(w, CookieOpts{Secure: h.CookieSecure, CSRFCookieDomain: h.CSRFCookieDomain})
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// issueTokens genere les access et refresh tokens pour un utilisateur.
func (h Handler) issueTokens(user *users.User) (access string, accessExp time.Time, refresh string, refreshExp time.Time, refreshJTI string, err error) {
	now := time.Now()

	accessExp = now.Add(h.AccessTTL)
	accessClaims := middleware.UserClaims{
		UserID:          user.ID,
		Email:           user.Email,
		Role:            user.Role,
		SessionRevision: userSessionRevision(user.UpdatedAt),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    h.Issuer,
			Subject:   user.Email,
			Audience:  []string{"access"},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(accessExp),
		},
	}
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	access, err = accessToken.SignedString([]byte(h.Secret))
	if err != nil {
		return
	}

	refreshExp = now.Add(h.RefreshTTL)
	refreshJTI, err = randomHex(16)
	if err != nil {
		return
	}
	refreshClaims := middleware.UserClaims{
		UserID:          user.ID,
		Email:           user.Email,
		Role:            user.Role,
		SessionRevision: userSessionRevision(user.UpdatedAt),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    h.Issuer,
			Subject:   user.Email,
			Audience:  []string{"refresh"},
			ID:        refreshJTI,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(refreshExp),
		},
	}
	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refresh, err = refreshToken.SignedString([]byte(h.Secret))
	return
}

// startSession persiste le refresh token et pose les cookies de session.
func (h Handler) startSession(w http.ResponseWriter, user *users.User, failurePrefix string) (string, bool) {
	access, accessExp, refresh, refreshExp, refreshJTI, err := h.issueTokens(user)
	if err != nil {
		log.Error().
			Err(err).
			Str("email", user.Email).
			Msg(failurePrefix + ": token generation error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "token error")
		return "", false
	}

	if err := h.Store.SetWithExpiry(user.Email, refreshJTI, refreshExp); err != nil {
		log.Error().
			Err(err).
			Str("email", user.Email).
			Msg(failurePrefix + ": refresh store error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "token error")
		return "", false
	}

	csrf, err := randomHex(32)
	if err != nil {
		log.Error().
			Err(err).
			Str("email", user.Email).
			Msg(failurePrefix + ": csrf generation error")

		httpx.WriteJSONError(w, http.StatusInternalServerError, "token error")
		return "", false
	}

	setCsrfCookie(w, csrf, refreshExp, CookieOpts{Secure: h.CookieSecure, CSRFCookieDomain: h.CSRFCookieDomain})
	setAuthCookies(w, access, accessExp, refresh, refreshExp, CookieOpts{Secure: h.CookieSecure})
	writeCSRFHeader(w, csrf)
	return csrf, true
}

// randomHex genere une chaine aleatoire encodee en hexadecimal.
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// userSessionRevision convertit la date de mise a jour en revision de session.
func userSessionRevision(updatedAt time.Time) int64 {
	if updatedAt.IsZero() {
		return 0
	}

	return updatedAt.UTC().UnixMicro()
}

// hasAudience verifie qu'un token contient l'audience attendue.
func hasAudience(audiences []string, expected string) bool {
	for _, audience := range audiences {
		if audience == expected {
			return true
		}
	}

	return false
}

// toAuthUserDTO transforme un utilisateur domaine en reponse API.
func toAuthUserDTO(user *users.User) contracts.AuthUserDTO {
	accountID := user.ID
	if user.AccountID != 0 {
		accountID = user.AccountID
	}
	var organizationID *int64
	if user.OrganizationID != 0 {
		organizationID = &user.OrganizationID
	}
	username := strings.TrimSpace(user.FirstName)
	if username == "" {
		username = strings.TrimSpace(user.LastName)
	}
	if username == "" {
		username = strings.Split(user.Email, "@")[0]
	}
	accountType := user.AccountType
	if accountType == "" {
		accountType = user.Role
	}
	createdAt := ""
	if !user.CreatedAt.IsZero() {
		createdAt = user.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	return contracts.AuthUserDTO{
		ID:               user.ID,
		AccountID:        accountID,
		UserID:           user.ProfileID,
		Email:            user.Email,
		LoginEmail:       user.Email,
		FirstName:        user.FirstName,
		LastName:         user.LastName,
		Username:         username,
		Role:             user.Role,
		AccountType:      accountType,
		IsActive:         user.IsActive,
		SuspendedUntil:   nullableTimeString(user.SuspendedUntil),
		SuspensionReason: nullableStringValue(user.SuspensionReason),
		CreatedAt:        createdAt,
		OrganizationID:   organizationID,
	}
}

// nullableTimeString convertit une date optionnelle en chaine JSON.
func nullableTimeString(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339Nano)
	return &formatted
}

// nullableStringValue retourne nil pour les chaines optionnelles vides.
func nullableStringValue(value *string) *string {
	if value == nil {
		return nil
	}
	return value
}

// writeLoginResponse ecrit la reponse JSON commune aux connexions.
func writeLoginResponse(w http.ResponseWriter, user *users.User, csrf string) {
	httpx.WriteJSON(w, http.StatusOK, contracts.LoginResponseDTO{
		OK:        true,
		User:      toAuthUserDTO(user),
		CSRFToken: csrf,
	})
}

// writeCSRFHeader expose le token CSRF courant dans les headers.
func writeCSRFHeader(w http.ResponseWriter, csrf string) {
	w.Header().Set("X-CSRF-Token", csrf)
}

// randomToken genere un token aleatoire pour le reset de mot de passe.
func randomToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// parseTrailingID extrait un identifiant place en fin de chemin.
func parseTrailingID(path string, suffix string) (int64, error) {
	value := strings.TrimSuffix(strings.TrimSpace(path), suffix)
	lastSlash := strings.LastIndex(value, "/")
	if lastSlash < 0 || lastSlash == len(value)-1 {
		return 0, strconv.ErrSyntax
	}
	id, err := strconv.ParseInt(value[lastSlash+1:], 10, 64)
	if err != nil || id <= 0 {
		return 0, strconv.ErrSyntax
	}
	return id, nil
}

// isLoopbackRequest verifie que la requete provient d'une adresse locale.
func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}

	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}

	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// isLoopbackRequestHost verifie que l'hote HTTP cible est local.
func isLoopbackRequestHost(r *http.Request) bool {
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return false
	}

	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}

	return config.IsLoopbackHost(host)
}

// refreshClaimsMatchCurrentUser verifie que le refresh token correspond encore a l'utilisateur.
func refreshClaimsMatchCurrentUser(user *users.User, claims *middleware.UserClaims) bool {
	if user == nil || claims == nil {
		return false
	}
	if user.ID != claims.UserID {
		return false
	}
	if !strings.EqualFold(user.Email, claims.Subject) {
		return false
	}
	if user.Role != claims.Role {
		return false
	}

	currentRevision := userSessionRevision(user.UpdatedAt)
	if currentRevision == 0 {
		return true
	}

	return claims.SessionRevision == currentRevision
}

// isAllowedBrowserOrigin controle l'origine navigateur pour les requetes sensibles.
func isAllowedBrowserOrigin(r *http.Request, frontendURL string) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		return matchesAllowedOrigin(origin, frontendURL)
	}

	referer := strings.TrimSpace(r.Header.Get("Referer"))
	if referer == "" {
		return false
	}

	return matchesAllowedOrigin(referer, frontendURL)
}

// matchesAllowedOrigin compare une origine candidate a l'origine frontend autorisee.
func matchesAllowedOrigin(candidate string, frontendURL string) bool {
	candidateURL, err := url.Parse(candidate)
	if err != nil {
		return false
	}

	allowedURL, err := url.Parse(strings.TrimSpace(frontendURL))
	if err != nil {
		return false
	}

	return strings.EqualFold(candidateURL.Scheme, allowedURL.Scheme) &&
		strings.EqualFold(candidateURL.Host, allowedURL.Host)
}

// isJSONContentType verifie que le Content-Type est compatible JSON.
func isJSONContentType(rawContentType string) bool {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(rawContentType))
	if err != nil {
		return false
	}

	return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
}

// firstNonBlank retourne la premiere valeur non vide.
func firstNonBlank(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// normalizeEmail nettoie et met en minuscule une adresse email.
func normalizeEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

// validatePublicRegistration valide les champs communs aux inscriptions publiques.
func validatePublicRegistration(email, username, password string) error {
	if err := validateEmail(email); err != nil {
		return err
	}
	if utf8.RuneCountInString(email) > 150 {
		return errors.New("email is too long")
	}
	if strings.TrimSpace(username) == "" {
		return errors.New("username is required")
	}
	if utf8.RuneCountInString(username) > 100 {
		return errors.New("username is too long")
	}
	for _, r := range username {
		if unicode.IsControl(r) {
			return errors.New("username cannot contain control characters")
		}
	}
	return validatePassword(password)
}

// validateOrganizationRegistrationFields valide les limites des champs organisation.
func validateOrganizationRegistrationFields(req contracts.RegisterOrganizationRequestDTO) error {
	for _, value := range []struct {
		name  string
		field string
		max   int
	}{
		{"name", req.Name, 90},
		{"contact email", req.ContactEmail, 150},
		{"member job role", req.MemberJobRole, 50},
		{"website", req.Website, 255},
		{"city", req.City, 50},
		{"postal_code", req.PostalCode, 10},
		{"logo", req.Logo, 255},
		{"contact_phone_number", req.ContactPhoneNumber, 20},
		{"siret", req.SIRET, 50},
	} {
		if utf8.RuneCountInString(strings.TrimSpace(value.field)) > value.max {
			return errors.New(value.name + " is too long")
		}
	}

	for _, r := range strings.TrimSpace(req.Description) {
		if unicode.IsControl(r) && r != '\n' && r != '\t' && r != '\r' {
			return errors.New("description cannot contain control characters")
		}
	}

	return nil
}

// validateEmail verifie le format et la longueur d'une adresse email.
func validateEmail(email string) error {
	if email == "" || len(email) > 254 || strings.ContainsAny(email, " \t\r\n") {
		return errors.New("email is invalid")
	}
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		return errors.New("email is invalid")
	}
	return nil
}

// validatePassword verifie les contraintes minimales d'un mot de passe.
func validatePassword(password string) error {
	if strings.TrimSpace(password) == "" {
		return errors.New("password is required")
	}
	if password != strings.TrimSpace(password) {
		return errors.New("password cannot start or end with whitespace")
	}
	if utf8.RuneCountInString(password) < 8 {
		return errors.New("password too short")
	}
	if utf8.RuneCountInString(password) > 128 {
		return errors.New("password too long")
	}
	for _, r := range password {
		if unicode.IsControl(r) {
			return errors.New("password cannot contain control characters")
		}
	}
	return nil
}

// writeAuthMutationError traduit les erreurs repository en reponses HTTP.
func writeAuthMutationError(w http.ResponseWriter, err error) {
	if errors.Is(err, users.ErrEmailAlreadyUsed) {
		httpx.WriteJSONError(w, http.StatusConflict, "email already used")
		return
	}
	if errors.Is(err, users.ErrUsernameAlreadyUsed) {
		httpx.WriteJSONError(w, http.StatusConflict, "username already used")
		return
	}
	if errors.Is(err, users.ErrOrganizationSIRETAlreadyUsed) {
		httpx.WriteJSONError(w, http.StatusConflict, "organization siret already used")
		return
	}
	if errors.Is(err, users.ErrOrganizationAccountAlreadyUsed) {
		httpx.WriteJSONError(w, http.StatusConflict, "account already has an organization")
		return
	}
	if errors.Is(err, users.ErrOrganizationCategoryNotFound) {
		httpx.WriteJSONError(w, http.StatusBadRequest, "organization category not found")
		return
	}
	if errors.Is(err, users.ErrEventCategoryNotFound) {
		httpx.WriteJSONError(w, http.StatusBadRequest, "event category not found")
		return
	}
	if errors.Is(err, users.ErrUserNotFound) {
		httpx.WriteJSONError(w, http.StatusNotFound, "user not found")
		return
	}

	log.Error().Err(err).Msg("auth mutation failed")
	httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
}

// writeAuthServiceError traduit les erreurs service en reponses HTTP.
func writeAuthServiceError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrInvalidAuthInput) {
		message := strings.TrimPrefix(err.Error(), ErrInvalidAuthInput.Error()+": ")
		httpx.WriteJSONError(w, http.StatusBadRequest, message)
		return
	}
	if errors.Is(err, ErrInvalidRegistration) {
		message := strings.TrimPrefix(err.Error(), ErrInvalidRegistration.Error()+": ")
		httpx.WriteJSONError(w, http.StatusBadRequest, message)
		return
	}
	if errors.Is(err, ErrPasswordHashFailed) {
		log.Error().Err(err).Msg("auth password hash failed")
		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeAuthMutationError(w, err)
}

// writeGeocodingError traduit les erreurs de geocodage en reponses HTTP.
func writeGeocodingError(w http.ResponseWriter, err error) {
	if errors.Is(err, geocoding.ErrNoMatch) {
		httpx.WriteJSONError(w, http.StatusBadRequest, "address could not be geocoded")
		return
	}

	log.Error().Err(err).Msg("auth organization geocoding failed")
	httpx.WriteJSONError(w, http.StatusBadGateway, "address geocoding service unavailable")
}

// normalizeSlugs nettoie, dedoublonne et normalise les slugs recus.
func normalizeSlugs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
