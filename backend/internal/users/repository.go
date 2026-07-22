package users

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrUserNotFound                   = errors.New("user not found")
	ErrEmailAlreadyUsed               = errors.New("email already used")
	ErrUsernameAlreadyUsed            = errors.New("username already used")
	ErrOrganizationSIRETAlreadyUsed   = errors.New("organization siret already used")
	ErrOrganizationAccountAlreadyUsed = errors.New("account already has an organization")
	ErrOrganizationCategoryNotFound   = errors.New("organization category not found")
	ErrEventCategoryNotFound          = errors.New("event category not found")
)

type Repository struct {
	db *sql.DB
}

type OrganizationRegistration struct {
	Email              string
	PasswordHash       string
	MemberName         string
	MemberJobRole      string
	Name               string
	ContactEmail       string
	Description        string
	Website            string
	Latitude           *float64
	Longitude          *float64
	Address            string
	City               string
	PostalCode         string
	Logo               string
	ContactPhoneNumber string
	SIRET              string
	CategorySlugs      []string
	IsVerified         bool
	IsActive           bool
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

const userSelect = `
	SELECT
		a.id,
		u.id,
		COALESCE(o.id, 0),
		a.login_email,
		a.password_hash,
		u.username,
		'',
		r.slug,
		at.slug,
		a.is_active,
		a.suspended_until,
		a.suspension_reason,
		a.created_at,
		GREATEST(a.updated_at, u.updated_at),
		a.deleted_at
	FROM accounts a
	JOIN account_types at ON at.id = a.account_type_id
	JOIN users u ON u.account_id = a.id
	JOIN roles r ON r.id = u.role_id
	LEFT JOIN organizations o ON o.account_id = a.id AND o.deleted_at IS NULL
`

func scanUser(scanner interface {
	Scan(dest ...any) error
}) (*User, error) {
	var user User
	var profileID int64
	var suspendedUntil sql.NullTime
	var suspensionReason sql.NullString
	err := scanner.Scan(
		&user.ID,
		&profileID,
		&user.OrganizationID,
		&user.Email,
		&user.PasswordHash,
		&user.FirstName,
		&user.LastName,
		&user.Role,
		&user.AccountType,
		&user.IsActive,
		&suspendedUntil,
		&suspensionReason,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DeletedAt,
	)
	if err != nil {
		return nil, err
	}
	user.AccountID = user.ID
	user.ProfileID = profileID
	user.SuspendedUntil = nullableTime(suspendedUntil)
	user.SuspensionReason = nullableString(suspensionReason)
	if user.LastName == "" {
		user.LastName = ""
	}
	return &user, nil
}

func (r *Repository) GetByEmail(ctx context.Context, email string) (*User, error) {
	query := userSelect + `
		WHERE LOWER(a.login_email) = LOWER($1)
		  AND a.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		LIMIT 1
	`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, email))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}

	return user, nil
}

func (r *Repository) GetByID(ctx context.Context, id int64) (*User, error) {
	query := userSelect + `
		WHERE a.id = $1
		  AND a.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		LIMIT 1
	`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}

	return user, nil
}

func (r *Repository) List(ctx context.Context) ([]User, error) {
	query := userSelect + `
		WHERE a.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		ORDER BY a.id ASC
	`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, *user)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate users: %w", err)
	}

	return users, nil
}

func (r *Repository) Create(ctx context.Context, user *User) (int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin create user tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	id, profileID, err := createAccountUserInTx(ctx, tx, user)
	if err != nil {
		return 0, err
	}
	if err := replaceEventPreferencesInTx(ctx, tx, profileID, user.PreferenceSlugs); err != nil {
		return 0, err
	}
	if err := createAccountNotification(ctx, tx, id, "welcome_email", "Bienvenue sur Mappening", "Votre compte Mappening est prêt.", "/account"); err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit create user tx: %w", err)
	}

	user.ID = id
	user.AccountID = id
	user.ProfileID = profileID

	return id, nil
}

func (r *Repository) CreateOrganization(ctx context.Context, registration OrganizationRegistration) (*User, int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("begin create organization tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	account := &User{
		Email:        registration.Email,
		PasswordHash: registration.PasswordHash,
		FirstName:    registration.MemberName,
		Role:         "organization",
		AccountType:  "organization",
		IsActive:     true,
	}
	accountID, userID, err := createAccountUserInTx(ctx, tx, account)
	if err != nil {
		return nil, 0, err
	}

	var organizationID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO organizations (
			account_id,
			name,
			contact_email,
			role_id,
			description,
			website,
			latitude,
			longitude,
			address,
			city,
			postal_code,
			logo,
			contact_phone_number,
			siret,
			is_verified,
			is_active
		)
		SELECT $1, $2, $3, r.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		FROM roles r
		WHERE r.slug = 'organization'
		RETURNING id
	`,
		accountID,
		registration.Name,
		registration.ContactEmail,
		nullIfBlank(registration.Description),
		nullIfBlank(registration.Website),
		registration.Latitude,
		registration.Longitude,
		registration.Address,
		registration.City,
		registration.PostalCode,
		nullIfBlank(registration.Logo),
		nullIfBlank(registration.ContactPhoneNumber),
		nullIfBlank(registration.SIRET),
		registration.IsVerified,
		registration.IsActive,
	).Scan(&organizationID)
	if err != nil {
		return nil, 0, mapOrganizationConstraintError(err)
	}

	if err := replaceOrganizationCategoriesInTx(ctx, tx, organizationID, registration.CategorySlugs); err != nil {
		return nil, 0, err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO organizers (user_id, organization_id, job_role)
		VALUES ($1, $2, $3)
	`, userID, organizationID, nullIfBlank(registration.MemberJobRole))
	if err != nil {
		return nil, 0, fmt.Errorf("create organizer: %w", err)
	}
	if err := createAccountNotification(ctx, tx, accountID, "welcome_email", "Bienvenue sur Mappening", "Votre espace organisation est prêt. Il sera visible après validation.", "/organization"); err != nil {
		return nil, 0, err
	}

	if err := tx.Commit(); err != nil {
		return nil, 0, fmt.Errorf("commit create organization tx: %w", err)
	}

	createdUser, err := r.GetByID(ctx, accountID)
	if err != nil {
		return nil, 0, err
	}

	return createdUser, organizationID, nil
}

func (r *Repository) Update(ctx context.Context, user *User, passwordHash *string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin update user tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := updateUserInTx(ctx, tx, user, passwordHash); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit update user tx: %w", err)
	}

	return nil
}

func (r *Repository) UpdatePreservingAdminAccess(ctx context.Context, currentUserID int64, user *User, passwordHash *string) error {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin protected update user tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	activeAdmins, err := lockActiveAdminRows(ctx, tx)
	if err != nil {
		return err
	}

	originalUser, err := getUserByIDForUpdate(ctx, tx, user.ID)
	if err != nil {
		return err
	}

	if currentUserID == originalUser.ID && !isActiveAdmin(*user) {
		return ErrSelfAdminAccessRemoval
	}

	if isActiveAdmin(*originalUser) && !isActiveAdmin(*user) && activeAdmins <= 1 {
		return ErrLastActiveAdmin
	}

	if err := updateUserInTx(ctx, tx, user, passwordHash); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit protected update user tx: %w", err)
	}

	return nil
}

func (r *Repository) UpdatePassword(ctx context.Context, userID int64, passwordHash string) error {
	const query = `
		UPDATE accounts
		SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
		WHERE id = $2
		  AND deleted_at IS NULL
	`

	res, err := r.db.ExecContext(ctx, query, passwordHash, userID)
	if err != nil {
		return fmt.Errorf("update user password: %w", err)
	}

	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update user password rows affected: %w", err)
	}
	if n == 0 {
		return ErrUserNotFound
	}

	if err := createAccountNotification(ctx, r.db, userID, "password_changed", "Mot de passe modifié", "Votre mot de passe vient d'être modifié.", "/account/profile/change-password"); err != nil {
		return err
	}

	return nil
}

func (r *Repository) UpdateProfile(ctx context.Context, accountID int64, email string, username string) (*User, error) {
	current, err := r.GetByID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	current.Email = strings.TrimSpace(strings.ToLower(email))
	current.FirstName = strings.TrimSpace(username)
	current.LastName = ""
	if current.Email == "" || current.FirstName == "" {
		return nil, ErrUserNotFound
	}

	if err := r.Update(ctx, current, nil); err != nil {
		return nil, err
	}
	return r.GetByID(ctx, accountID)
}

func (r *Repository) CreatePasswordResetToken(ctx context.Context, email string, token string, expiresAt time.Time) (bool, error) {
	user, err := r.GetByEmail(ctx, strings.TrimSpace(strings.ToLower(email)))
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return false, nil
		}
		return false, err
	}
	if !user.IsActive || user.DeletedAt != nil {
		return false, nil
	}

	tokenHash := hashToken(token)
	if _, err := r.db.ExecContext(ctx, `
		INSERT INTO password_reset_tokens (token_hash, account_id, expires_at)
		VALUES ($1, $2, $3)
	`, tokenHash, user.ID, expiresAt); err != nil {
		return false, fmt.Errorf("create password reset token: %w", err)
	}
	if err := createAccountNotification(ctx, r.db, user.ID, "password_reset_requested", "Réinitialisation demandée", "Un lien de réinitialisation de mot de passe vient d'être envoyé.", "/account/profile/change-password"); err != nil {
		return false, err
	}
	return true, nil
}

func (r *Repository) ResetPasswordWithToken(ctx context.Context, token string, passwordHash string) error {
	tokenHash := hashToken(token)

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin reset password tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var accountID int64
	err = tx.QueryRowContext(ctx, `
		SELECT account_id
		FROM password_reset_tokens
		WHERE token_hash = $1
		  AND used_at IS NULL
		  AND expires_at > NOW()
		FOR UPDATE
	`, tokenHash).Scan(&accountID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrUserNotFound
		}
		return fmt.Errorf("find password reset token: %w", err)
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE accounts
		SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
		WHERE id = $2
		  AND deleted_at IS NULL
	`, passwordHash, accountID)
	if err != nil {
		return fmt.Errorf("reset password: %w", err)
	}
	if err := requireRows(res, ErrUserNotFound); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE password_reset_tokens
		SET used_at = NOW()
		WHERE token_hash = $1
	`, tokenHash); err != nil {
		return fmt.Errorf("consume password reset token: %w", err)
	}

	if err := createAccountNotification(ctx, tx, accountID, "password_changed", "Mot de passe modifié", "Votre mot de passe vient d'être modifié.", "/account/profile/change-password"); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit reset password tx: %w", err)
	}
	return nil
}

func (r *Repository) UserProfileID(ctx context.Context, accountID int64) (int64, error) {
	var userID int64
	err := r.db.QueryRowContext(ctx, `
		SELECT id
		FROM users
		WHERE account_id = $1
		  AND deleted_at IS NULL
	`, accountID).Scan(&userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrUserNotFound
		}
		return 0, fmt.Errorf("get user profile id: %w", err)
	}
	return userID, nil
}

func (r *Repository) ListEventPreferences(ctx context.Context, accountID int64) ([]EventPreference, error) {
	userID, err := r.UserProfileID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT uep.id, uep.user_id, uep.event_category_id, ec.slug, uep.created_at
		FROM user_event_preferences uep
		JOIN event_categories ec ON ec.id = uep.event_category_id
		WHERE uep.user_id = $1
		ORDER BY ec.slug ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list event preferences: %w", err)
	}
	defer rows.Close()

	var preferences []EventPreference
	for rows.Next() {
		var preference EventPreference
		if err := rows.Scan(&preference.ID, &preference.UserID, &preference.EventCategoryID, &preference.CategorySlug, &preference.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan event preference: %w", err)
		}
		preferences = append(preferences, preference)
	}
	return preferences, rows.Err()
}

func (r *Repository) ReplaceEventPreferences(ctx context.Context, accountID int64, categorySlugs []string) ([]EventPreference, error) {
	userID, err := r.UserProfileID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin replace preferences tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := replaceEventPreferencesInTx(ctx, tx, userID, categorySlugs); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit replace preferences tx: %w", err)
	}
	return r.ListEventPreferences(ctx, accountID)
}

func replaceEventPreferencesInTx(ctx context.Context, tx *sql.Tx, userID int64, categorySlugs []string) error {
	normalizedSlugs := normalizeUniqueSlugs(categorySlugs)
	if len(normalizedSlugs) == 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM user_event_preferences WHERE user_id = $1`, userID); err != nil {
			return fmt.Errorf("clear event preferences: %w", err)
		}
		return nil
	}

	categoryIDs := make([]int64, 0, len(normalizedSlugs))
	for _, slug := range normalizedSlugs {
		var categoryID int64
		err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM event_categories
			WHERE slug = $1
		`, slug).Scan(&categoryID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrEventCategoryNotFound
			}
			return fmt.Errorf("resolve event preference category: %w", err)
		}
		categoryIDs = append(categoryIDs, categoryID)

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_event_preferences (user_id, event_category_id)
			VALUES ($1, $2)
			ON CONFLICT (user_id, event_category_id)
			DO NOTHING
		`, userID, categoryID); err != nil {
			return fmt.Errorf("upsert event preference: %w", err)
		}
	}

	placeholders := makeSQLPlaceholders(2, len(categoryIDs))
	args := make([]any, 0, len(categoryIDs)+1)
	args = append(args, userID)
	for _, categoryID := range categoryIDs {
		args = append(args, categoryID)
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM user_event_preferences
		WHERE user_id = $1
		  AND event_category_id NOT IN (`+strings.Join(placeholders, ", ")+`)
	`, args...); err != nil {
		return fmt.Errorf("delete removed event preferences: %w", err)
	}

	return nil
}

func normalizeUniqueSlugs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
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

func makeSQLPlaceholders(start int, count int) []string {
	placeholders := make([]string, count)
	for i := 0; i < count; i++ {
		placeholders[i] = fmt.Sprintf("$%d", start+i)
	}
	return placeholders
}

func (r *Repository) ListNotifications(ctx context.Context, accountID int64) ([]Notification, error) {
	userID, err := r.UserProfileID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, user_id, event_id, organization_id, notification_type_id,
			title, message, is_read, read_at, action_url, created_at
		FROM notifications
		WHERE user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT 100
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()

	var notifications []Notification
	for rows.Next() {
		notification, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		notifications = append(notifications, *notification)
	}
	return notifications, rows.Err()
}

func (r *Repository) ListNotificationTypes(ctx context.Context) ([]NotificationType, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, slug
		FROM notification_types
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list notification types: %w", err)
	}
	defer rows.Close()

	var types []NotificationType
	for rows.Next() {
		var item NotificationType
		if err := rows.Scan(&item.ID, &item.Name, &item.Slug); err != nil {
			return nil, fmt.Errorf("scan notification type: %w", err)
		}
		types = append(types, item)
	}
	return types, rows.Err()
}

func (r *Repository) MarkNotificationRead(ctx context.Context, accountID int64, notificationID int64) (*Notification, error) {
	userID, err := r.UserProfileID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	notification, err := scanNotification(r.db.QueryRowContext(ctx, `
		UPDATE notifications
		SET is_read = TRUE,
		    read_at = COALESCE(read_at, NOW())
		WHERE id = $1
		  AND user_id = $2
		RETURNING id, user_id, event_id, organization_id, notification_type_id,
			title, message, is_read, read_at, action_url, created_at
	`, notificationID, userID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("mark notification read: %w", err)
	}
	return notification, nil
}

func (r *Repository) MarkAllNotificationsRead(ctx context.Context, accountID int64) error {
	userID, err := r.UserProfileID(ctx, accountID)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `
		UPDATE notifications
		SET is_read = TRUE,
		    read_at = COALESCE(read_at, NOW())
		WHERE user_id = $1
		  AND is_read = FALSE
	`, userID)
	if err != nil {
		return fmt.Errorf("mark notifications read: %w", err)
	}
	return nil
}

type notificationExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func createAccountNotification(ctx context.Context, exec notificationExecutor, accountID int64, typeSlug string, title string, message string, actionURL string) error {
	res, err := exec.ExecContext(ctx, `
		INSERT INTO notifications (user_id, notification_type_id, title, message, action_url)
		SELECT u.id, nt.id, $3, $4, $5
		FROM users u
		JOIN notification_types nt ON nt.slug = $2
		WHERE u.account_id = $1
		  AND u.deleted_at IS NULL
	`, accountID, typeSlug, title, message, actionURL)
	if err != nil {
		return fmt.Errorf("create account notification: %w", err)
	}
	if err := requireRows(res, ErrUserNotFound); err != nil {
		return err
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, userID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete user tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	res, err := tx.ExecContext(ctx, `
		UPDATE accounts
		SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW(), is_active = FALSE
		WHERE id = $1
		  AND deleted_at IS NULL
	`, userID)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete user rows affected: %w", err)
	}
	if n == 0 {
		return ErrUserNotFound
	}
	if err := softDeleteAccountRelations(ctx, tx, userID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete user tx: %w", err)
	}

	return nil
}

func (r *Repository) DeletePreservingAdminAccess(ctx context.Context, currentUserID int64, userID int64) (*User, error) {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, fmt.Errorf("begin protected delete user tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	activeAdmins, err := lockActiveAdminRows(ctx, tx)
	if err != nil {
		return nil, err
	}

	user, err := getUserByIDForUpdate(ctx, tx, userID)
	if err != nil {
		return nil, err
	}

	if currentUserID == user.ID {
		return nil, ErrSelfDeletion
	}

	if isActiveAdmin(*user) && activeAdmins <= 1 {
		return nil, ErrLastActiveAdmin
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE accounts
		SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW(), is_active = FALSE
		WHERE id = $1
		  AND deleted_at IS NULL
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("delete user: %w", err)
	}

	n, err := res.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("delete user rows affected: %w", err)
	}
	if n == 0 {
		return nil, ErrUserNotFound
	}
	if err := softDeleteAccountRelations(ctx, tx, userID); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit protected delete user tx: %w", err)
	}

	return user, nil
}

func softDeleteAccountRelations(ctx context.Context, tx *sql.Tx, accountID int64) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE users
		SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
		WHERE account_id = $1
		  AND deleted_at IS NULL
	`, accountID); err != nil {
		return fmt.Errorf("delete user profiles: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE organizers
		SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
		WHERE user_id IN (
			SELECT id
			FROM users
			WHERE account_id = $1
		)
		  AND deleted_at IS NULL
	`, accountID); err != nil {
		return fmt.Errorf("delete organizer memberships: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE organizations
		SET is_active = FALSE,
		    is_verified = FALSE,
		    deleted_at = COALESCE(deleted_at, NOW()),
		    updated_at = NOW()
		WHERE account_id = $1
		  AND deleted_at IS NULL
	`, accountID); err != nil {
		return fmt.Errorf("delete organizations: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE events
		SET is_active = FALSE,
		    deleted_at = COALESCE(deleted_at, NOW()),
		    updated_at = NOW()
		WHERE organization_id IN (
			SELECT id
			FROM organizations
			WHERE account_id = $1
		)
		  AND deleted_at IS NULL
	`, accountID); err != nil {
		return fmt.Errorf("delete organization events: %w", err)
	}

	return nil
}

func (r *Repository) Deactivate(ctx context.Context, userID int64) error {
	const query = `
		UPDATE accounts
		SET is_active = FALSE, updated_at = NOW()
		WHERE id = $1
		  AND deleted_at IS NULL
	`

	res, err := r.db.ExecContext(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("deactivate user: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("deactivate user rows affected: %w", err)
	}
	if n == 0 {
		return ErrUserNotFound
	}
	return nil
}

func createAccountUserInTx(ctx context.Context, tx *sql.Tx, user *User) (int64, int64, error) {
	role := strings.TrimSpace(strings.ToLower(user.Role))
	accountType := strings.TrimSpace(strings.ToLower(user.AccountType))
	if accountType == "" {
		accountType = role
	}
	username := strings.TrimSpace(user.FirstName)
	if username == "" {
		username = strings.TrimSpace(user.LastName)
	}
	if username == "" {
		username = strings.Split(user.Email, "@")[0]
	}

	var accountID int64
	err := tx.QueryRowContext(ctx, `
		INSERT INTO accounts (account_type_id, login_email, password_hash, is_active)
		SELECT at.id, $1, $2, $3
		FROM account_types at
		WHERE at.slug = $4
		RETURNING id, created_at
	`, user.Email, user.PasswordHash, user.IsActive, accountType).Scan(
		&accountID,
		&user.CreatedAt,
	)
	if err != nil {
		return 0, 0, mapConstraintError("create account", err)
	}

	var userID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO users (account_id, username, role_id)
		SELECT $1, $2, r.id
		FROM roles r
		WHERE r.slug = $3
		RETURNING id
	`, accountID, username, role).Scan(&userID)
	if err != nil {
		return 0, 0, mapConstraintError("create user profile", err)
	}

	return accountID, userID, nil
}

func updateUserInTx(ctx context.Context, tx *sql.Tx, user *User, passwordHash *string) error {
	role := strings.TrimSpace(strings.ToLower(user.Role))
	accountType := strings.TrimSpace(strings.ToLower(user.AccountType))
	if accountType == "" {
		accountType = role
	}
	username := strings.TrimSpace(user.FirstName)
	if username == "" {
		username = strings.TrimSpace(user.LastName)
	}
	if username == "" {
		username = strings.Split(user.Email, "@")[0]
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE accounts
		SET
			login_email = $1,
			account_type_id = (SELECT id FROM account_types WHERE slug = $2),
			is_active = $3,
			updated_at = NOW()
		WHERE id = $4
		  AND deleted_at IS NULL
	`, user.Email, accountType, user.IsActive, user.ID)
	if err != nil {
		return mapConstraintError("update account", err)
	}

	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update account rows affected: %w", err)
	}
	if n == 0 {
		return ErrUserNotFound
	}

	res, err = tx.ExecContext(ctx, `
		UPDATE users
		SET
			username = $1,
			role_id = (SELECT id FROM roles WHERE slug = $2),
			updated_at = NOW()
		WHERE account_id = $3
		  AND deleted_at IS NULL
	`, username, role, user.ID)
	if err != nil {
		return mapConstraintError("update user profile", err)
	}

	n, err = res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update user rows affected: %w", err)
	}
	if n == 0 {
		return ErrUserNotFound
	}

	if passwordHash == nil {
		return nil
	}

	res, err = tx.ExecContext(ctx, `
		UPDATE accounts
		SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
		WHERE id = $2
		  AND deleted_at IS NULL
	`, *passwordHash, user.ID)
	if err != nil {
		return fmt.Errorf("update user password: %w", err)
	}

	n, err = res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update user password rows affected: %w", err)
	}
	if n == 0 {
		return ErrUserNotFound
	}

	return nil
}

func getUserByIDForUpdate(ctx context.Context, tx *sql.Tx, id int64) (*User, error) {
	query := userSelect + `
		WHERE a.id = $1
		  AND a.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		FOR UPDATE OF a, u
	`

	user, err := scanUser(tx.QueryRowContext(ctx, query, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("get user by id for update: %w", err)
	}

	return user, nil
}

func lockActiveAdminRows(ctx context.Context, tx *sql.Tx) (int, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT a.id
		FROM accounts a
		JOIN users u ON u.account_id = a.id
		JOIN roles r ON r.id = u.role_id
		WHERE r.slug = 'admin'
		  AND a.is_active = TRUE
		  AND a.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		ORDER BY a.id
		FOR UPDATE OF a, u
	`)
	if err != nil {
		return 0, fmt.Errorf("lock active admin rows: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, fmt.Errorf("scan active admin row: %w", err)
		}
		count++
	}

	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate active admin rows: %w", err)
	}

	return count, nil
}

func mapConstraintError(action string, err error) error {
	msg := err.Error()
	if strings.Contains(msg, "idx_accounts_login_email_active") ||
		strings.Contains(msg, "accounts_login_email") {
		return ErrEmailAlreadyUsed
	}
	if strings.Contains(msg, "idx_users_username_active") ||
		strings.Contains(msg, "users_username") {
		return ErrUsernameAlreadyUsed
	}

	return fmt.Errorf("%s: %w", action, err)
}

func mapOrganizationConstraintError(err error) error {
	msg := err.Error()
	if strings.Contains(msg, "idx_organizations_contact_email_active") ||
		strings.Contains(msg, "organizations_contact_email") {
		return ErrEmailAlreadyUsed
	}
	if strings.Contains(msg, "idx_organizations_siret_active") ||
		strings.Contains(msg, "organizations_siret") {
		return ErrOrganizationSIRETAlreadyUsed
	}
	if strings.Contains(msg, "organizations_account_id_key") {
		return ErrOrganizationAccountAlreadyUsed
	}

	return fmt.Errorf("create organization: %w", err)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

func scanNotification(scanner interface {
	Scan(dest ...any) error
}) (*Notification, error) {
	var notification Notification
	var eventID sql.NullInt64
	var organizationID sql.NullInt64
	var readAt sql.NullTime
	var actionURL sql.NullString
	if err := scanner.Scan(
		&notification.ID,
		&notification.UserID,
		&eventID,
		&organizationID,
		&notification.NotificationTypeID,
		&notification.Title,
		&notification.Message,
		&notification.IsRead,
		&readAt,
		&actionURL,
		&notification.CreatedAt,
	); err != nil {
		return nil, err
	}
	notification.EventID = nullableInt(eventID)
	notification.OrganizationID = nullableInt(organizationID)
	notification.ReadAt = nullableTime(readAt)
	notification.ActionURL = nullableString(actionURL)
	return &notification, nil
}

func nullableInt(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func nullableTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func requireRows(res sql.Result, notFound error) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return notFound
	}
	return nil
}

func nullIfBlank(value string) sql.NullString {
	value = strings.TrimSpace(value)
	return sql.NullString{String: value, Valid: value != ""}
}

func replaceOrganizationCategoriesInTx(ctx context.Context, tx *sql.Tx, organizationID int64, categorySlugs []string) error {
	seen := make(map[int64]struct{})
	for _, slug := range categorySlugs {
		slug = strings.TrimSpace(strings.ToLower(slug))
		if slug == "" {
			continue
		}

		var categoryID int64
		err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM organization_categories
			WHERE slug = $1
		`, slug).Scan(&categoryID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrOrganizationCategoryNotFound
			}
			return fmt.Errorf("resolve organization category: %w", err)
		}
		if _, ok := seen[categoryID]; ok {
			continue
		}
		seen[categoryID] = struct{}{}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO organization_categories_links (organization_id, organization_category_id)
			VALUES ($1, $2)
			ON CONFLICT (organization_id, organization_category_id) DO NOTHING
		`, organizationID, categoryID); err != nil {
			return fmt.Errorf("create organization category link: %w", err)
		}
	}

	return nil
}
