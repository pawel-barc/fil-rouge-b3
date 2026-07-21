package users

import (
	"errors"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"mappening/internal/contracts"
	"mappening/internal/httpx"
)

var allowedRoles = map[string]struct{}{
	"admin":        {},
	"moderator":    {},
	"organization": {},
	"user":         {},
}

var (
	ErrSelfAdminAccessRemoval = errors.New("you cannot remove your own active admin access")
	ErrSelfDeletion           = errors.New("you cannot delete your own account")
	ErrLastActiveAdmin        = errors.New("cannot remove the last active admin")
)

type AdminHandler struct {
	Service AdminService
}

// Retourne la liste admin des utilisateurs.
func (h AdminHandler) List(w http.ResponseWriter, r *http.Request) {
	if h.Service == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "user service not configured")
		return
	}

	users, err := h.Service.List(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("list users failed")
		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	resp := make([]contracts.AdminUserDTO, 0, len(users))
	for _, u := range users {
		resp = append(resp, toAdminUserDTO(u))
	}

	httpx.WriteJSON(w, http.StatusOK, resp)
}

// Cree un nouvel utilisateur avec mot de passe hashé.
func (h AdminHandler) Create(w http.ResponseWriter, r *http.Request) {
	if h.Service == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "user service not configured")
		return
	}

	var req contracts.CreateAdminUserDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	user, err := h.Service.Create(r.Context(), req)
	if err != nil {
		if isAdminBadRequest(err) {
			httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Error().Err(err).Msg("create user failed")
		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, toAdminUserDTO(*user))
}

// Met a jour un utilisateur et revoque ses sessions si son etat d'auth change.
func (h AdminHandler) Update(w http.ResponseWriter, r *http.Request) {
	if h.Service == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "user service not configured")
		return
	}

	id, err := strconv.ParseInt(chi.URLParam(r, "userID"), 10, 64)
	if err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	var req contracts.UpdateAdminUserDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	currentUserID, _ := httpx.CurrentUserIDFromContext(r.Context())
	user, err := h.Service.Update(r.Context(), id, currentUserID, req)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			httpx.WriteJSONError(w, http.StatusNotFound, "user not found")
			return
		}
		if isAdminProtectionError(err) {
			httpx.WriteJSONError(w, http.StatusConflict, err.Error())
			return
		}
		if isAdminBadRequest(err) {
			httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Error().Err(err).Msg("update user failed")
		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toAdminUserDTO(*user))
}

// Supprime un utilisateur puis invalide ses sessions actives.
func (h AdminHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if h.Service == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "user service not configured")
		return
	}

	id, err := strconv.ParseInt(chi.URLParam(r, "userID"), 10, 64)
	if err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	currentUserID, _ := httpx.CurrentUserIDFromContext(r.Context())
	err = h.Service.Delete(r.Context(), id, currentUserID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			httpx.WriteJSONError(w, http.StatusNotFound, "user not found")
			return
		}
		if isAdminProtectionError(err) {
			httpx.WriteJSONError(w, http.StatusConflict, err.Error())
			return
		}
		log.Error().Err(err).Msg("delete user failed")
		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Reinitialise le mot de passe d'un utilisateur puis force une reconnexion.
func (h AdminHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	if h.Service == nil {
		httpx.WriteJSONError(w, http.StatusInternalServerError, "user service not configured")
		return
	}

	id, err := strconv.ParseInt(chi.URLParam(r, "userID"), 10, 64)
	if err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	var req contracts.ResetPasswordDTO
	if err := httpx.DecodeStrictJSON(w, r, &req); err != nil {
		httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.Service.ResetPassword(r.Context(), id, req); err != nil {
		if errors.Is(err, ErrUserNotFound) {
			httpx.WriteJSONError(w, http.StatusNotFound, "user not found")
			return
		}
		if isAdminBadRequest(err) {
			httpx.WriteJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Error().Err(err).Msg("reset password failed")
		httpx.WriteJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Applique les regles minimales de robustesse sur un mot de passe administrateur.
func validateNewPassword(password string) error {
	const (
		minPasswordLength = 12
		maxPasswordLength = 128
	)

	if strings.TrimSpace(password) == "" {
		return ErrInvalidAdminUserInput("Le mot de passe est obligatoire")
	}
	if password != strings.TrimSpace(password) {
		return ErrInvalidAdminUserInput("Le mot de passe ne peut pas commencer ou se terminer par un espace")
	}
	if utf8.RuneCountInString(password) < minPasswordLength {
		return ErrInvalidAdminUserInput("Le mot de passe doit contenir au moins 12 caracteres")
	}
	if utf8.RuneCountInString(password) > maxPasswordLength {
		return ErrInvalidAdminUserInput("Le mot de passe doit contenir au maximum 128 caracteres")
	}
	for _, r := range password {
		if unicode.IsControl(r) {
			return ErrInvalidAdminUserInput("Le mot de passe ne peut pas contenir de caracteres de controle")
		}
	}

	return nil
}

// Valide les champs utilisateur avant ecriture afin d'eviter des erreurs SQL
// exposees sous forme de 500 et de garder les contraintes proches de l'API.
func validateUserProfile(email, firstName, lastName string) error {
	if err := validateEmail(email); err != nil {
		return err
	}
	if err := validateDisplayName("first_name", firstName); err != nil {
		return err
	}
	if err := validateDisplayName("last_name", lastName); err != nil {
		return err
	}

	return nil
}

func validateEmail(email string) error {
	const maxEmailLength = 254

	if email == "" {
		return errors.New("email is required")
	}
	if len(email) > maxEmailLength {
		return errors.New("email is too long")
	}
	if strings.ContainsAny(email, " \t\r\n") {
		return errors.New("email is invalid")
	}

	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		return errors.New("email is invalid")
	}

	parts := strings.Split(email, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return errors.New("email is invalid")
	}

	return nil
}

func validateDisplayName(field string, value string) error {
	const maxNameLength = 100

	if utf8.RuneCountInString(value) > maxNameLength {
		return errors.New(field + " is too long")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return errors.New(field + " cannot contain control characters")
		}
	}

	return nil
}

func isAdminProtectionError(err error) bool {
	return errors.Is(err, ErrSelfAdminAccessRemoval) ||
		errors.Is(err, ErrSelfDeletion) ||
		errors.Is(err, ErrLastActiveAdmin)
}

func isAdminBadRequest(err error) bool {
	var inputErr ErrInvalidAdminUserInput
	return errors.As(err, &inputErr) ||
		strings.Contains(err.Error(), "required") ||
		strings.Contains(err.Error(), "invalid") ||
		strings.Contains(err.Error(), "too long") ||
		strings.Contains(err.Error(), "too short") ||
		strings.Contains(err.Error(), "cannot")
}

// Convertit le modele utilisateur en DTO admin sans exposer le hash du mot de passe.
func toAdminUserDTO(user User) contracts.AdminUserDTO {
	return contracts.AdminUserDTO{
		ID:        user.ID,
		Email:     user.Email,
		FirstName: user.FirstName,
		LastName:  user.LastName,
		Role:      user.Role,
		IsActive:  user.IsActive,
	}
}

// Verifie que le role demande fait partie de la liste blanche.
func isAllowedRole(role string) bool {
	_, ok := allowedRoles[strings.TrimSpace(strings.ToLower(role))]
	return ok
}

func isActiveAdmin(user User) bool {
	return strings.EqualFold(strings.TrimSpace(user.Role), "admin") && user.IsActive
}
