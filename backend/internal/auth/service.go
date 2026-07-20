package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"mappening/internal/contracts"
	"mappening/internal/users"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials  = errors.New("invalid credentials")
	ErrUserInactive        = errors.New("user inactive")
	ErrInvalidAuthInput    = errors.New("invalid auth input")
	ErrInvalidRegistration = errors.New("invalid registration")
	ErrPasswordHashFailed  = errors.New("password hash failed")
)

// AuthService porte la logique applicative d'authentification.
type AuthService struct {
	userRepo authUserStore
}

// PasswordResetRequest decrit une demande de reset preparee par le service.
type PasswordResetRequest struct {
	Email     string
	Token     string
	Exists    bool
	ExpiresAt time.Time
}

// Construit le service d'authentification a partir du repository utilisateurs.
func NewAuthService(userRepo authUserStore) *AuthService {
	return &AuthService{
		userRepo: userRepo,
	}
}

// authUserStore regroupe les capacites attendues du repository utilisateurs.
type authUserStore interface {
	authUserReader
	authUserCreator
	authOrganizationCreator
	authUserPasswordUpdater
	authUserProfileUpdater
	authPasswordResetter
	authUserPreferencesService
	authUserNotificationsService
	authUserDeleter
}

// Verifie les identifiants d'un utilisateur et refuse les comptes inactifs ou suspendus.
func (s *AuthService) Login(ctx context.Context, email, password string) (*users.User, error) {
	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		return nil, err
	}

	if user == nil {
		return nil, ErrInvalidCredentials
	}

	if !isUserAllowedToAuthenticate(user) {
		return nil, ErrUserInactive
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return user, nil
}

// GetByEmail recupere un utilisateur a partir de son email.
func (s *AuthService) GetByEmail(ctx context.Context, email string) (*users.User, error) {
	return s.userRepo.GetByEmail(ctx, email)
}

// UpdateProfileFromRequest valide puis applique une demande de mise a jour profil.
func (s *AuthService) UpdateProfileFromRequest(ctx context.Context, accountID int64, req contracts.UpdateProfileRequestDTO) (*users.User, error) {
	email := normalizeEmail(firstNonBlank(req.LoginEmail, req.Email))
	username := strings.TrimSpace(req.Username)
	if err := validateEmail(email); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidAuthInput, err)
	}
	if username == "" {
		return nil, fmt.Errorf("%w: username is required", ErrInvalidAuthInput)
	}
	if utf8.RuneCountInString(username) > 100 {
		return nil, fmt.Errorf("%w: username is too long", ErrInvalidAuthInput)
	}

	return s.userRepo.UpdateProfile(ctx, accountID, email, username)
}

// RegisterUser valide, hash le mot de passe et cree un compte utilisateur.
func (s *AuthService) RegisterUser(ctx context.Context, req contracts.RegisterUserRequestDTO) (*users.User, error) {
	email := normalizeEmail(firstNonBlank(req.LoginEmail, req.Email))
	username := strings.TrimSpace(req.Username)
	if err := validatePublicRegistration(email, username, req.Password); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidRegistration, err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPasswordHashFailed, err)
	}

	user := &users.User{
		Email:           email,
		PasswordHash:    string(hash),
		FirstName:       username,
		Role:            "user",
		AccountType:     "user",
		IsActive:        true,
		PreferenceSlugs: normalizeSlugs(req.CategorySlugs),
	}

	id, err := s.userRepo.Create(ctx, user)
	if err != nil {
		return nil, err
	}
	user.ID = id

	return user, nil
}

// Create delegue la creation brute d'un utilisateur au repository.
func (s *AuthService) Create(ctx context.Context, user *users.User) (int64, error) {
	return s.userRepo.Create(ctx, user)
}

// RegisterOrganization valide et cree le compte organisation associe.
func (s *AuthService) RegisterOrganization(
	ctx context.Context,
	req contracts.RegisterOrganizationRequestDTO,
	normalizedAddress normalizedOrganizationAddress,
) (*users.User, int64, error) {
	email := normalizeEmail(firstNonBlank(req.LoginEmail, req.Email))
	memberName := strings.TrimSpace(req.MemberName)
	if err := validatePublicRegistration(email, memberName, req.Password); err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrInvalidRegistration, err)
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.ContactEmail) == "" ||
		strings.TrimSpace(req.Address) == "" || strings.TrimSpace(req.City) == "" ||
		strings.TrimSpace(req.PostalCode) == "" {
		return nil, 0, fmt.Errorf("%w: organization fields are required", ErrInvalidRegistration)
	}
	if err := validateEmail(normalizeEmail(req.ContactEmail)); err != nil {
		return nil, 0, fmt.Errorf("%w: contact email is invalid", ErrInvalidRegistration)
	}
	if err := validateOrganizationRegistrationFields(req); err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrInvalidRegistration, err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrPasswordHashFailed, err)
	}

	return s.userRepo.CreateOrganization(ctx, users.OrganizationRegistration{
		Email:              email,
		PasswordHash:       string(hash),
		MemberName:         memberName,
		MemberJobRole:      strings.TrimSpace(req.MemberJobRole),
		Name:               strings.TrimSpace(req.Name),
		ContactEmail:       normalizeEmail(req.ContactEmail),
		Description:        strings.TrimSpace(req.Description),
		Website:            strings.TrimSpace(req.Website),
		Latitude:           normalizedAddress.latitude,
		Longitude:          normalizedAddress.longitude,
		Address:            normalizedAddress.address,
		City:               normalizedAddress.city,
		PostalCode:         normalizedAddress.postalCode,
		Logo:               strings.TrimSpace(req.Logo),
		ContactPhoneNumber: strings.TrimSpace(req.ContactPhoneNumber),
		SIRET:              strings.TrimSpace(req.SIRET),
		CategorySlugs:      normalizeSlugs(req.CategorySlugs),
		IsVerified:         false,
		IsActive:           false,
	})
}

// CreateOrganization delegue la creation brute d'une organisation au repository.
func (s *AuthService) CreateOrganization(ctx context.Context, registration users.OrganizationRegistration) (*users.User, int64, error) {
	return s.userRepo.CreateOrganization(ctx, registration)
}

// UpdatePassword delegue la mise a jour directe du hash de mot de passe.
func (s *AuthService) UpdatePassword(ctx context.Context, userID int64, passwordHash string) error {
	return s.userRepo.UpdatePassword(ctx, userID, passwordHash)
}

// ChangePassword verifie l'ancien mot de passe puis enregistre le nouveau hash.
func (s *AuthService) ChangePassword(ctx context.Context, email string, req contracts.ChangePasswordRequestDTO) (*users.User, error) {
	currentPassword := firstNonBlank(req.CurrentPassword, req.OldPassword)
	if strings.TrimSpace(currentPassword) == "" {
		return nil, fmt.Errorf("%w: current password is required", ErrInvalidAuthInput)
	}
	if err := validatePassword(req.NewPassword); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidAuthInput, err)
	}

	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(currentPassword)); err != nil {
		return nil, ErrInvalidCredentials
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPasswordHashFailed, err)
	}
	if err := s.userRepo.UpdatePassword(ctx, user.ID, string(hash)); err != nil {
		return nil, err
	}

	return user, nil
}

// UpdateProfile delegue la mise a jour directe du profil au repository.
func (s *AuthService) UpdateProfile(ctx context.Context, accountID int64, email string, username string) (*users.User, error) {
	return s.userRepo.UpdateProfile(ctx, accountID, email, username)
}

// CreatePasswordResetToken delegue la creation brute d'un token de reset.
func (s *AuthService) CreatePasswordResetToken(ctx context.Context, email string, token string, expiresAt time.Time) (bool, error) {
	return s.userRepo.CreatePasswordResetToken(ctx, email, token, expiresAt)
}

// RequestPasswordReset valide l'email et prepare un token de reset temporaire.
func (s *AuthService) RequestPasswordReset(ctx context.Context, req contracts.ForgotPasswordRequestDTO) (*PasswordResetRequest, error) {
	email := normalizeEmail(firstNonBlank(req.LoginEmail, req.Email))
	if err := validateEmail(email); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidAuthInput, err)
	}

	token, err := randomToken()
	if err != nil {
		return nil, fmt.Errorf("generate reset token: %w", err)
	}

	expiresAt := time.Now().UTC().Add(30 * time.Minute)
	exists, err := s.userRepo.CreatePasswordResetToken(ctx, email, token, expiresAt)
	if err != nil {
		return nil, err
	}

	return &PasswordResetRequest{
		Email:     email,
		Token:     token,
		Exists:    exists,
		ExpiresAt: expiresAt,
	}, nil
}

// ResetPasswordWithToken delegue le reset direct depuis un token et un hash.
func (s *AuthService) ResetPasswordWithToken(ctx context.Context, token string, passwordHash string) error {
	return s.userRepo.ResetPasswordWithToken(ctx, token, passwordHash)
}

// ResetPassword valide le token, hash le nouveau mot de passe et l'enregistre.
func (s *AuthService) ResetPassword(ctx context.Context, req contracts.ResetPasswordRequestDTO) error {
	token := strings.TrimSpace(req.Token)
	password := firstNonBlank(req.NewPassword, req.Password)
	if token == "" {
		return fmt.Errorf("%w: token is required", ErrInvalidAuthInput)
	}
	if err := validatePassword(password); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidAuthInput, err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrPasswordHashFailed, err)
	}

	return s.userRepo.ResetPasswordWithToken(ctx, token, string(hash))
}

// ListEventPreferences retourne les preferences evenementielles d'un compte.
func (s *AuthService) ListEventPreferences(ctx context.Context, accountID int64) ([]users.EventPreference, error) {
	return s.userRepo.ListEventPreferences(ctx, accountID)
}

// ReplaceEventPreferences remplace les preferences evenementielles d'un compte.
func (s *AuthService) ReplaceEventPreferences(ctx context.Context, accountID int64, categorySlugs []string) ([]users.EventPreference, error) {
	return s.userRepo.ReplaceEventPreferences(ctx, accountID, categorySlugs)
}

// ListNotificationTypes retourne les types de notifications disponibles.
func (s *AuthService) ListNotificationTypes(ctx context.Context) ([]users.NotificationType, error) {
	return s.userRepo.ListNotificationTypes(ctx)
}

// ListNotifications retourne les notifications d'un compte.
func (s *AuthService) ListNotifications(ctx context.Context, accountID int64) ([]users.Notification, error) {
	return s.userRepo.ListNotifications(ctx, accountID)
}

// MarkNotificationRead marque une notification comme lue.
func (s *AuthService) MarkNotificationRead(ctx context.Context, accountID int64, notificationID int64) (*users.Notification, error) {
	return s.userRepo.MarkNotificationRead(ctx, accountID, notificationID)
}

// MarkAllNotificationsRead marque toutes les notifications d'un compte comme lues.
func (s *AuthService) MarkAllNotificationsRead(ctx context.Context, accountID int64) error {
	return s.userRepo.MarkAllNotificationsRead(ctx, accountID)
}

// Deactivate desactive un compte utilisateur.
func (s *AuthService) Deactivate(ctx context.Context, userID int64) error {
	return s.userRepo.Deactivate(ctx, userID)
}

// Delete supprime un compte utilisateur.
func (s *AuthService) Delete(ctx context.Context, userID int64) error {
	return s.userRepo.Delete(ctx, userID)
}

// isUserAllowedToAuthenticate verifie qu'un utilisateur peut ouvrir une session.
func isUserAllowedToAuthenticate(user *users.User) bool {
	return user != nil && user.IsActive && !user.IsSuspended(time.Now().UTC())
}
