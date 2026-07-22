package staff

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"mappening/internal/events"
	"mappening/internal/mailer"
)

var (
	ErrNotFound   = errors.New("staff resource not found")
	ErrForbidden  = errors.New("staff action forbidden")
	ErrValidation = errors.New("invalid staff request")
)

type Repository struct {
	db          *sql.DB
	eventRepo   *events.Repository
	mailSender  mailer.Sender
	frontendURL string
}

func NewRepository(db *sql.DB) *Repository {
	return NewRepositoryWithMailer(db, nil, "")
}

func NewRepositoryWithMailer(db *sql.DB, sender mailer.Sender, frontendURL string) *Repository {
	return &Repository{db: db, eventRepo: events.NewRepository(db, nil), mailSender: sender, frontendURL: strings.TrimRight(frontendURL, "/")}
}

func (r *Repository) ApplyAction(ctx context.Context, req ActionRequest, moderatorUserID int64, role string) error {
	req.Action = strings.TrimSpace(strings.ToLower(req.Action))
	req.TargetType = strings.TrimSpace(strings.ToLower(req.TargetType))
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Action == "" || req.TargetType == "" || req.TargetID <= 0 || len(req.Reason) < 5 {
		return ErrValidation
	}
	if !canApplyAction(role, req.Action) {
		return ErrForbidden
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin staff action tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := r.applyTargetMutation(ctx, tx, req); err != nil {
		return err
	}
	if req.ReportID != nil {
		status := "reviewing"
		if req.ReportStatus != nil && strings.TrimSpace(*req.ReportStatus) != "" {
			status = strings.TrimSpace(strings.ToLower(*req.ReportStatus))
		}
		if err := updateReportInTx(ctx, tx, *req.ReportID, req.TargetType, req.TargetID, status, moderatorUserID, req.Reason); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderation_decisions (report_id, action, target_type, target_id, moderator_user_id, reason)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, req.ReportID, req.Action, req.TargetType, req.TargetID, moderatorUserID, req.Reason); err != nil {
		return fmt.Errorf("record moderation decision: %w", err)
	}
	emailMessages, err := r.createActionNotification(ctx, tx, req)
	if err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit staff action tx: %w", err)
	}
	r.sendActionEmails(emailMessages)

	return nil
}

func (r *Repository) CreateReport(ctx context.Context, req CreateReportRequest, authenticatedUserID int64) (*ModerationReport, error) {
	req.TargetType = strings.TrimSpace(strings.ToLower(req.TargetType))
	req.Reason = strings.TrimSpace(req.Reason)
	req.Details = strings.TrimSpace(req.Details)
	req.Priority = strings.TrimSpace(strings.ToLower(req.Priority))
	if req.Priority == "" {
		req.Priority = "medium"
	}
	if req.Priority != "low" && req.Priority != "medium" && req.Priority != "high" {
		return nil, ErrValidation
	}
	if req.ReporterUserID <= 0 {
		req.ReporterUserID = authenticatedUserID
	}
	if req.TargetID <= 0 || req.TargetType == "" || req.Reason == "" || len(req.Details) < 10 {
		return nil, ErrValidation
	}
	if req.ReporterUserID != authenticatedUserID {
		return nil, ErrForbidden
	}
	if err := r.ensureReportTargetExists(ctx, req.TargetType, req.TargetID); err != nil {
		return nil, err
	}

	var report ModerationReport
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO moderation_reports (
			target_type, target_id, reporter_user_id, reason, details, priority
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, target_type, target_id, reporter_user_id, reason, details,
			status, priority, created_at, updated_at, resolved_at,
			handled_by_user_id, resolution_note
	`, req.TargetType, req.TargetID, req.ReporterUserID, req.Reason, req.Details, req.Priority).Scan(
		&report.ID,
		&report.TargetType,
		&report.TargetID,
		&report.ReporterUserID,
		&report.Reason,
		&report.Details,
		&report.Status,
		&report.Priority,
		&report.CreatedAt,
		&report.UpdatedAt,
		&report.ResolvedAt,
		&report.HandledByUserID,
		&report.ResolutionNote,
	)
	if err != nil {
		if strings.Contains(err.Error(), "idx_moderation_reports_open_unique") {
			return nil, ErrValidation
		}
		return nil, fmt.Errorf("create moderation report: %w", err)
	}
	return &report, nil
}

func (r *Repository) ensureReportTargetExists(ctx context.Context, targetType string, targetID int64) error {
	var table string
	switch targetType {
	case "event":
		table = "events"
	case "organization":
		table = "organizations"
	case "account":
		table = "accounts"
	default:
		return ErrValidation
	}

	query := fmt.Sprintf("SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1 AND deleted_at IS NULL)", table)
	var exists bool
	if err := r.db.QueryRowContext(ctx, query, targetID).Scan(&exists); err != nil {
		return fmt.Errorf("check moderation target: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) applyTargetMutation(ctx context.Context, tx *sql.Tx, req ActionRequest) error {
	var res sql.Result
	var err error
	switch req.Action {
	case "account_suspended":
		res, err = tx.ExecContext(ctx, `
			UPDATE accounts
			SET suspended_until = $1, suspension_reason = $2, updated_at = NOW()
			WHERE id = $3 AND deleted_at IS NULL
		`, parseOptionalActionTime(req.SuspendedUntil), req.Reason, req.TargetID)
	case "account_restored":
		res, err = tx.ExecContext(ctx, `
			UPDATE accounts
			SET suspended_until = NULL, suspension_reason = NULL, is_active = TRUE, updated_at = NOW()
			WHERE id = $1 AND deleted_at IS NULL
		`, req.TargetID)
	case "account_deleted":
		res, err = tx.ExecContext(ctx, `
			UPDATE accounts
			SET deleted_at = COALESCE(deleted_at, NOW()), is_active = FALSE, updated_at = NOW()
			WHERE id = $1
		`, req.TargetID)
		if err == nil {
			err = softDeleteAccountRelationsInTx(ctx, tx, req.TargetID)
		}
	case "event_approved", "event_restored":
		res, err = tx.ExecContext(ctx, `
			UPDATE events
			SET is_active = TRUE, deleted_at = NULL, suspended_until = NULL,
			    suspension_reason = NULL, updated_at = NOW()
			WHERE id = $1
		`, req.TargetID)
	case "event_hidden":
		res, err = tx.ExecContext(ctx, `
			UPDATE events
			SET suspended_until = $1, suspension_reason = $2, updated_at = NOW()
			WHERE id = $3 AND deleted_at IS NULL
		`, parseOptionalActionTime(req.SuspendedUntil), req.Reason, req.TargetID)
	case "event_rejected", "event_deleted":
		res, err = tx.ExecContext(ctx, `
			UPDATE events
			SET is_active = FALSE, deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
			WHERE id = $1
		`, req.TargetID)
	case "organization_approved":
		res, err = tx.ExecContext(ctx, `
			UPDATE organizations
			SET is_active = TRUE, is_verified = TRUE, deleted_at = NULL, updated_at = NOW()
			WHERE id = $1
		`, req.TargetID)
	case "organization_rejected", "organization_deleted":
		res, err = tx.ExecContext(ctx, `
			UPDATE organizations
			SET is_active = FALSE, is_verified = FALSE,
			    deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
			WHERE id = $1
		`, req.TargetID)
	case "organization_admin_updated", "event_admin_updated", "account_admin_updated", "report_reviewing", "report_resolved", "report_dismissed":
		return nil
	default:
		return ErrValidation
	}
	if err != nil {
		return fmt.Errorf("apply staff action %s: %w", req.Action, err)
	}
	if res == nil {
		return nil
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("staff action rows affected: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	if req.Action == "account_suspended" || req.Action == "account_deleted" {
		if err := deleteRefreshTokensForAccount(ctx, tx, req.TargetID); err != nil {
			return err
		}
	}
	switch req.Action {
	case "organization_approved":
		if err := syncOrganizationAccountActive(ctx, tx, req.TargetID, true); err != nil {
			return err
		}
	case "organization_rejected", "organization_deleted":
		if err := syncOrganizationAccountActive(ctx, tx, req.TargetID, false); err != nil {
			return err
		}
	}
	return nil
}

func softDeleteAccountRelationsInTx(ctx context.Context, tx *sql.Tx, accountID int64) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE users
		SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
		WHERE account_id = $1
		  AND deleted_at IS NULL
	`, accountID); err != nil {
		return fmt.Errorf("delete staff user profiles: %w", err)
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
		return fmt.Errorf("delete staff organizer memberships: %w", err)
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
		return fmt.Errorf("delete staff organizations: %w", err)
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
		return fmt.Errorf("delete staff organization events: %w", err)
	}

	return nil
}

func deleteRefreshTokensForAccount(ctx context.Context, tx *sql.Tx, accountID int64) error {
	_, err := tx.ExecContext(ctx, `
		DELETE FROM auth_refresh_tokens
		WHERE subject IN (
			SELECT login_email
			FROM accounts
			WHERE id = $1
		)
	`, accountID)
	if err != nil {
		return fmt.Errorf("delete account refresh tokens: %w", err)
	}
	return nil
}

func syncOrganizationAccountActive(ctx context.Context, tx *sql.Tx, organizationID int64, active bool) error {
	var accountID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT account_id
		FROM organizations
		WHERE id = $1
	`, organizationID).Scan(&accountID); err != nil {
		return fmt.Errorf("find organization account: %w", err)
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE accounts
		SET is_active = $1,
		    updated_at = NOW()
		WHERE id = $2
		  AND deleted_at IS NULL
	`, active, accountID)
	if err != nil {
		return fmt.Errorf("sync organization account active: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("sync organization account rows affected: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	if active {
		return nil
	}
	return deleteRefreshTokensForAccount(ctx, tx, accountID)
}

func (r *Repository) createActionNotification(ctx context.Context, tx *sql.Tx, req ActionRequest) ([]mailer.Message, error) {
	recipientUserIDs, organizationID, eventID, err := recipientUsersForAction(ctx, tx, req.TargetType, req.TargetID)
	if err != nil {
		return nil, err
	}
	if len(recipientUserIDs) == 0 {
		return nil, nil
	}

	typeID, err := notificationTypeForAction(ctx, tx, req.Action)
	if err != nil {
		return nil, err
	}
	title := notificationTitle(req.Action)
	message := notificationMessage(req.Action, req.Reason)
	actionPath := actionURL(req.TargetType, req.TargetID)
	messages := make([]mailer.Message, 0, len(recipientUserIDs))
	for _, recipient := range recipientUserIDs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO notifications (
				user_id, event_id, organization_id, notification_type_id, title, message, action_url
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, recipient.UserID, eventID, organizationID, typeID, title, message, actionPath); err != nil {
			return nil, fmt.Errorf("create action notification: %w", err)
		}
		messages = append(messages, r.notificationEmail(recipient, title, message, actionPath))
	}
	return messages, nil
}

func (r *Repository) summary(ctx context.Context, options ListOptions) (*Summary, error) {
	var summary Summary
	accountWhere := "a.deleted_at IS NULL"
	if options.Role == "moderator" {
		accountWhere += `
			AND NOT EXISTS (
				SELECT 1
				FROM users su
				JOIN roles sr ON sr.id = su.role_id
				WHERE su.account_id = a.id
				  AND su.deleted_at IS NULL
				  AND sr.slug IN ('admin', 'moderator')
			)
		`
	}
	if err := r.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE `+accountWhere+`),
			COUNT(*) FILTER (WHERE `+accountWhere+` AND a.is_active = FALSE)
		FROM accounts a
	`).Scan(&summary.Accounts.Total, &summary.Accounts.Pending); err != nil {
		return nil, fmt.Errorf("count staff accounts summary: %w", err)
	}
	if err := r.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE e.deleted_at IS NULL),
			COUNT(*) FILTER (
				WHERE e.deleted_at IS NULL
				  AND e.is_active = FALSE
				  AND (e.suspended_until IS NULL OR e.suspended_until <= NOW())
				  AND (
					latest_decision.action IS NULL
					OR latest_decision.action NOT IN ('event_rejected', 'event_hidden', 'event_deleted')
				  )
			)
		FROM events e
		LEFT JOIN LATERAL (
			SELECT md.action
			FROM moderation_decisions md
			WHERE md.target_type = 'event'
			  AND md.target_id = e.id
			ORDER BY md.created_at DESC, md.id DESC
			LIMIT 1
		) latest_decision ON TRUE
	`).Scan(&summary.Events.Total, &summary.Events.Pending); err != nil {
		return nil, fmt.Errorf("count staff events summary: %w", err)
	}
	if err := r.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE o.deleted_at IS NULL),
			COUNT(*) FILTER (
				WHERE o.deleted_at IS NULL
				  AND o.is_active = FALSE
				  AND (
					latest_decision.action IS NULL
					OR latest_decision.action NOT IN ('organization_rejected')
				  )
			)
		FROM organizations o
		LEFT JOIN LATERAL (
			SELECT md.action
			FROM moderation_decisions md
			WHERE md.target_type = 'organization'
			  AND md.target_id = o.id
			ORDER BY md.created_at DESC, md.id DESC
			LIMIT 1
		) latest_decision ON TRUE
	`).Scan(&summary.Organizations.Total, &summary.Organizations.Pending); err != nil {
		return nil, fmt.Errorf("count staff organizations summary: %w", err)
	}
	if err := r.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status = 'open')
		FROM moderation_reports
	`).Scan(&summary.Reports.Total, &summary.Reports.Pending); err != nil {
		return nil, fmt.Errorf("count staff reports summary: %w", err)
	}
	return &summary, nil
}

func (r *Repository) listAccounts(ctx context.Context, options ListOptions) ([]Account, error) {
	clauses := []string{}
	args := []any{}
	if options.Query != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(options.Query))+"%")
		clauses = append(clauses, "(LOWER(a.login_email) LIKE $1 OR LOWER(at.slug) LIKE $1)")
	}
	switch options.Status {
	case "active":
		clauses = append(clauses, "a.is_active = TRUE AND a.deleted_at IS NULL AND (a.suspended_until IS NULL OR a.suspended_until <= NOW())")
	case "suspended":
		clauses = append(clauses, "a.suspended_until IS NOT NULL AND a.suspended_until > NOW()")
	case "deleted":
		clauses = append(clauses, "a.deleted_at IS NOT NULL")
	case "pending":
		clauses = append(clauses, "a.is_active = FALSE AND a.deleted_at IS NULL")
	default:
		clauses = append(clauses, "a.deleted_at IS NULL")
	}
	if options.Role == "moderator" {
		clauses = append(clauses, `
			NOT EXISTS (
				SELECT 1
				FROM users su
				JOIN roles sr ON sr.id = su.role_id
				WHERE su.account_id = a.id
				  AND su.deleted_at IS NULL
				  AND sr.slug IN ('admin', 'moderator')
			)
		`)
	}
	query := `
		SELECT a.id, a.account_type_id, at.slug, a.login_email,
			a.password_changed_at, a.is_active, a.suspended_until,
			a.suspension_reason, a.created_at, a.updated_at, a.deleted_at
		FROM accounts a
		JOIN account_types at ON at.id = a.account_type_id
	` + staffWhere(clauses) + `
		ORDER BY a.id ASC`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list staff accounts: %w", err)
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var account Account
		var passwordChangedAt sql.NullTime
		var suspendedUntil sql.NullTime
		var suspensionReason sql.NullString
		var deletedAt sql.NullTime
		if err := rows.Scan(
			&account.ID,
			&account.AccountTypeID,
			&account.AccountType,
			&account.LoginEmail,
			&passwordChangedAt,
			&account.IsActive,
			&suspendedUntil,
			&suspensionReason,
			&account.CreatedAt,
			&account.UpdatedAt,
			&deletedAt,
		); err != nil {
			return nil, fmt.Errorf("scan staff account: %w", err)
		}
		account.PasswordChangedAt = nullableTime(passwordChangedAt)
		account.SuspendedUntil = nullableTime(suspendedUntil)
		account.SuspensionReason = nullableString(suspensionReason)
		account.DeletedAt = nullableTime(deletedAt)
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (r *Repository) listUsers(ctx context.Context, options ListOptions) ([]User, error) {
	clauses := []string{"u.deleted_at IS NULL", "a.deleted_at IS NULL"}
	args := []any{}
	if options.Query != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(options.Query))+"%")
		clauses = append(clauses, "(LOWER(u.username) LIKE $1 OR LOWER(r.slug) LIKE $1)")
	}
	if options.Role == "moderator" {
		clauses = append(clauses, "r.slug NOT IN ('admin', 'moderator')")
	}
	query := `
		SELECT u.id, u.account_id, u.username, u.role_id, r.slug,
			u.created_at, u.updated_at, u.deleted_at
		FROM users u
		JOIN roles r ON r.id = u.role_id
		JOIN accounts a ON a.id = u.account_id
	` + staffWhere(clauses) + `
		ORDER BY u.id ASC`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list staff users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var user User
		var deletedAt sql.NullTime
		if err := rows.Scan(&user.ID, &user.AccountID, &user.Username, &user.RoleID, &user.Role, &user.CreatedAt, &user.UpdatedAt, &deletedAt); err != nil {
			return nil, fmt.Errorf("scan staff user: %w", err)
		}
		user.DeletedAt = nullableTime(deletedAt)
		users = append(users, user)
	}
	return users, rows.Err()
}

func (r *Repository) listOrganizations(ctx context.Context, options ListOptions) ([]Organization, error) {
	clauses := []string{}
	args := []any{}
	if options.Query != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(options.Query))+"%")
		clauses = append(clauses, "(LOWER(o.name) LIKE $1 OR LOWER(o.contact_email) LIKE $1 OR LOWER(o.city) LIKE $1)")
	}
	switch options.Status {
	case "active":
		clauses = append(clauses, "o.is_active = TRUE AND o.deleted_at IS NULL")
	case "pending":
		clauses = append(clauses, "o.is_active = FALSE AND o.deleted_at IS NULL")
	case "verified":
		clauses = append(clauses, "o.is_verified = TRUE AND o.deleted_at IS NULL")
	case "deleted":
		clauses = append(clauses, "o.deleted_at IS NOT NULL")
	default:
		clauses = append(clauses, "o.deleted_at IS NULL", "a.deleted_at IS NULL")
	}
	query := `
		SELECT o.id, o.account_id, o.name, o.contact_email, o.role_id,
			o.description, o.website, o.latitude, o.longitude, o.address,
			o.city, o.postal_code, o.logo, o.contact_phone_number, o.siret,
			o.is_verified, o.is_active, o.created_at, o.updated_at, o.deleted_at,
			COALESCE(string_agg(DISTINCT oc.slug, ',' ORDER BY oc.slug), '') AS category_slugs
		FROM organizations o
		JOIN accounts a ON a.id = o.account_id
		LEFT JOIN organization_categories_links ocl ON ocl.organization_id = o.id
		LEFT JOIN organization_categories oc ON oc.id = ocl.organization_category_id
	` + staffWhere(clauses) + `
		GROUP BY o.id
		ORDER BY o.name ASC, o.id ASC`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list staff organizations: %w", err)
	}
	defer rows.Close()

	var organizations []Organization
	for rows.Next() {
		var organization Organization
		var roleID sql.NullInt64
		var description, website, logo, phone, siret sql.NullString
		var latitude, longitude sql.NullFloat64
		var deletedAt sql.NullTime
		var categorySlugs string
		if err := rows.Scan(
			&organization.ID,
			&organization.AccountID,
			&organization.Name,
			&organization.ContactEmail,
			&roleID,
			&description,
			&website,
			&latitude,
			&longitude,
			&organization.Address,
			&organization.City,
			&organization.PostalCode,
			&logo,
			&phone,
			&siret,
			&organization.IsVerified,
			&organization.IsActive,
			&organization.CreatedAt,
			&organization.UpdatedAt,
			&deletedAt,
			&categorySlugs,
		); err != nil {
			return nil, fmt.Errorf("scan staff organization: %w", err)
		}
		organization.RoleID = nullableInt(roleID)
		organization.Description = nullableString(description)
		organization.Website = nullableString(website)
		organization.Latitude = nullableFloat(latitude)
		organization.Longitude = nullableFloat(longitude)
		organization.Logo = nullableString(logo)
		organization.ContactPhoneNumber = nullableString(phone)
		organization.SIRET = nullableString(siret)
		organization.DeletedAt = nullableTime(deletedAt)
		organization.CategorySlugs = splitCSV(categorySlugs)
		organizations = append(organizations, organization)
	}
	return organizations, rows.Err()
}

func (r *Repository) listOrganizers(ctx context.Context, options ListOptions) ([]Organizer, error) {
	query := `
		SELECT org.id, org.user_id, org.organization_id, org.job_role,
			org.created_at, org.updated_at, org.deleted_at
		FROM organizers org
		JOIN users u ON u.id = org.user_id
		JOIN accounts a ON a.id = u.account_id
		JOIN organizations o ON o.id = org.organization_id
		WHERE org.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		  AND a.deleted_at IS NULL
		  AND o.deleted_at IS NULL
		ORDER BY org.id ASC`
	args := []any{}
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list staff organizers: %w", err)
	}
	defer rows.Close()

	var organizers []Organizer
	for rows.Next() {
		var organizer Organizer
		var jobRole sql.NullString
		var deletedAt sql.NullTime
		if err := rows.Scan(&organizer.ID, &organizer.UserID, &organizer.OrganizationID, &jobRole, &organizer.CreatedAt, &organizer.UpdatedAt, &deletedAt); err != nil {
			return nil, fmt.Errorf("scan staff organizer: %w", err)
		}
		organizer.JobRole = nullableString(jobRole)
		organizer.DeletedAt = nullableTime(deletedAt)
		organizers = append(organizers, organizer)
	}
	return organizers, rows.Err()
}

func (r *Repository) listEvents(ctx context.Context, options ListOptions) ([]events.Event, error) {
	eventList, err := r.eventRepo.List(ctx, staffEventListFilters(options))
	if err != nil {
		return nil, fmt.Errorf("list staff events: %w", err)
	}
	return eventList, nil
}

func staffEventListFilters(options ListOptions) events.ListFilters {
	return events.ListFilters{
		Query:           options.Query,
		IncludeInactive: true,
		Sort:            "newest",
	}
}

func staffWhere(clauses []string) string {
	if len(clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(clauses, " AND ")
}

func (r *Repository) listNotificationTypes(ctx context.Context) ([]NotificationType, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name, slug FROM notification_types ORDER BY id ASC`)
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

func (r *Repository) listNotifications(ctx context.Context, options ListOptions) ([]Notification, error) {
	clauses := []string{}
	args := []any{}
	if options.Query != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(options.Query))+"%")
		clauses = append(clauses, "(LOWER(title) LIKE $1 OR LOWER(message) LIKE $1)")
	}
	if options.Status == "unread" {
		clauses = append(clauses, "is_read = FALSE")
	}
	query := `
		SELECT id, user_id, event_id, organization_id, notification_type_id,
			title, message, is_read, read_at, action_url, created_at
		FROM notifications
	` + staffWhere(clauses) + `
		ORDER BY created_at DESC, id DESC`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list staff notifications: %w", err)
	}
	defer rows.Close()
	var notifications []Notification
	for rows.Next() {
		var notification Notification
		var eventID, organizationID sql.NullInt64
		var readAt sql.NullTime
		var actionURL sql.NullString
		if err := rows.Scan(
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
			return nil, fmt.Errorf("scan staff notification: %w", err)
		}
		notification.EventID = nullableInt(eventID)
		notification.OrganizationID = nullableInt(organizationID)
		notification.ReadAt = nullableTime(readAt)
		notification.ActionURL = nullableString(actionURL)
		notifications = append(notifications, notification)
	}
	return notifications, rows.Err()
}

func (r *Repository) listReports(ctx context.Context, options ListOptions) ([]ModerationReport, error) {
	clauses := []string{}
	args := []any{}
	if options.Query != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(options.Query))+"%")
		clauses = append(clauses, "(LOWER(reason) LIKE $1 OR LOWER(details) LIKE $1 OR LOWER(target_type) LIKE $1)")
	}
	switch options.Status {
	case "open", "reviewing", "resolved", "dismissed":
		args = append(args, options.Status)
		clauses = append(clauses, "status = $"+fmt.Sprint(len(args)))
	}
	query := `
		SELECT id, target_type, target_id, reporter_user_id, reason, details,
			status, priority, created_at, updated_at, resolved_at,
			handled_by_user_id, resolution_note
		FROM moderation_reports
	` + staffWhere(clauses) + `
		ORDER BY created_at DESC, id DESC`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list moderation reports: %w", err)
	}
	defer rows.Close()
	var reports []ModerationReport
	for rows.Next() {
		var report ModerationReport
		if err := rows.Scan(
			&report.ID,
			&report.TargetType,
			&report.TargetID,
			&report.ReporterUserID,
			&report.Reason,
			&report.Details,
			&report.Status,
			&report.Priority,
			&report.CreatedAt,
			&report.UpdatedAt,
			&report.ResolvedAt,
			&report.HandledByUserID,
			&report.ResolutionNote,
		); err != nil {
			return nil, fmt.Errorf("scan moderation report: %w", err)
		}
		reports = append(reports, report)
	}
	return reports, rows.Err()
}

func (r *Repository) listDecisions(ctx context.Context, options ListOptions) ([]ModerationDecision, error) {
	clauses := []string{}
	args := []any{}
	if options.Query != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(options.Query))+"%")
		clauses = append(clauses, "(LOWER(action) LIKE $1 OR LOWER(target_type) LIKE $1 OR LOWER(reason) LIKE $1)")
	}
	query := `
		SELECT id, report_id, action, target_type, target_id, moderator_user_id, reason, created_at
		FROM moderation_decisions
	` + staffWhere(clauses) + `
		ORDER BY created_at DESC, id DESC`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list moderation decisions: %w", err)
	}
	defer rows.Close()
	var decisions []ModerationDecision
	for rows.Next() {
		var decision ModerationDecision
		var reportID sql.NullInt64
		if err := rows.Scan(&decision.ID, &reportID, &decision.Action, &decision.TargetType, &decision.TargetID, &decision.ModeratorUserID, &decision.Reason, &decision.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan moderation decision: %w", err)
		}
		decision.ReportID = nullableInt(reportID)
		decisions = append(decisions, decision)
	}
	return decisions, rows.Err()
}

func updateReportInTx(ctx context.Context, tx *sql.Tx, reportID int64, targetType string, targetID int64, status string, moderatorUserID int64, note string) error {
	if status != "open" && status != "reviewing" && status != "resolved" && status != "dismissed" {
		return ErrValidation
	}
	var res sql.Result
	var err error
	if status == "resolved" || status == "dismissed" {
		res, err = tx.ExecContext(ctx, `
			UPDATE moderation_reports
			SET status = $1, handled_by_user_id = $2, resolution_note = $3,
			    resolved_at = NOW(), updated_at = NOW()
			WHERE id = $4
			  AND target_type = $5
			  AND target_id = $6
		`, status, moderatorUserID, note, reportID, targetType, targetID)
	} else {
		res, err = tx.ExecContext(ctx, `
			UPDATE moderation_reports
			SET status = $1, handled_by_user_id = $2, updated_at = NOW()
			WHERE id = $3
			  AND target_type = $4
			  AND target_id = $5
		`, status, moderatorUserID, reportID, targetType, targetID)
	}
	if err != nil {
		return fmt.Errorf("update moderation report: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update moderation report rows affected: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

type notificationRecipient struct {
	UserID int64
	Email  string
	Name   string
}

func recipientUsersForAction(ctx context.Context, tx *sql.Tx, targetType string, targetID int64) ([]notificationRecipient, *int64, *int64, error) {
	switch targetType {
	case "event":
		var eventID = targetID
		var organizationID sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT organization_id FROM events WHERE id = $1`, targetID).Scan(&organizationID); err != nil {
			return nil, nil, nil, fmt.Errorf("find event organization: %w", err)
		}
		if !organizationID.Valid {
			return nil, nil, &eventID, nil
		}
		users, err := organizationRecipientUsers(ctx, tx, organizationID.Int64)
		return users, &organizationID.Int64, &eventID, err
	case "organization":
		users, err := organizationRecipientUsers(ctx, tx, targetID)
		organizationID := targetID
		return users, &organizationID, nil, err
	case "account":
		var recipient notificationRecipient
		err := tx.QueryRowContext(ctx, `
			SELECT u.id, a.login_email, COALESCE(NULLIF(u.username, ''), SPLIT_PART(a.login_email, '@', 1))
			FROM users u
			JOIN accounts a ON a.id = u.account_id
			WHERE u.account_id = $1
			  AND u.deleted_at IS NULL
			  AND a.deleted_at IS NULL
			LIMIT 1
		`, targetID).Scan(&recipient.UserID, &recipient.Email, &recipient.Name)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil, nil
		}
		if err != nil {
			return nil, nil, nil, fmt.Errorf("find account notification user: %w", err)
		}
		return []notificationRecipient{recipient}, nil, nil, nil
	default:
		return nil, nil, nil, ErrValidation
	}
}

func organizationRecipientUsers(ctx context.Context, tx *sql.Tx, organizationID int64) ([]notificationRecipient, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT DISTINCT u.id, a.login_email, COALESCE(NULLIF(u.username, ''), SPLIT_PART(a.login_email, '@', 1))
		FROM users u
		JOIN accounts a ON a.id = u.account_id
		LEFT JOIN organizations o ON o.account_id = u.account_id AND o.id = $1
		LEFT JOIN organizers org ON org.user_id = u.id AND org.organization_id = $1 AND org.deleted_at IS NULL
		WHERE u.deleted_at IS NULL
		  AND a.deleted_at IS NULL
		  AND a.is_active = TRUE
		  AND (o.id IS NOT NULL OR org.id IS NOT NULL)
	`, organizationID)
	if err != nil {
		return nil, fmt.Errorf("list organization notification users: %w", err)
	}
	defer rows.Close()

	var users []notificationRecipient
	for rows.Next() {
		var recipient notificationRecipient
		if err := rows.Scan(&recipient.UserID, &recipient.Email, &recipient.Name); err != nil {
			return nil, fmt.Errorf("scan organization notification user: %w", err)
		}
		users = append(users, recipient)
	}
	return users, rows.Err()
}

func notificationTypeForAction(ctx context.Context, tx *sql.Tx, action string) (int64, error) {
	slug := "moderation_decision"
	switch action {
	case "organization_approved":
		slug = "organization_approved"
	case "organization_rejected", "organization_deleted":
		slug = "organization_rejected"
	case "event_approved":
		slug = "event_approved"
	case "event_rejected":
		slug = "event_rejected"
	case "event_hidden":
		slug = "event_hidden"
	case "event_deleted":
		slug = "event_deleted"
	case "account_suspended":
		slug = "account_suspended"
	}
	var id int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM notification_types WHERE slug = $1`, slug).Scan(&id); err != nil {
		return 0, fmt.Errorf("resolve notification type: %w", err)
	}
	return id, nil
}

func canApplyAction(role string, action string) bool {
	if strings.EqualFold(role, "admin") {
		return true
	}
	switch action {
	case "event_approved", "event_rejected", "event_hidden", "event_deleted", "event_restored",
		"organization_approved", "organization_rejected",
		"account_suspended", "account_restored",
		"report_reviewing", "report_resolved", "report_dismissed":
		return true
	default:
		return false
	}
}

func parseOptionalActionTime(raw *string) sql.NullTime {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return sql.NullTime{Time: time.Now().UTC().Add(30 * 24 * time.Hour), Valid: true}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02"} {
		if parsed, err := time.Parse(layout, strings.TrimSpace(*raw)); err == nil {
			return sql.NullTime{Time: parsed, Valid: true}
		}
	}
	return sql.NullTime{Time: time.Now().UTC().Add(30 * 24 * time.Hour), Valid: true}
}

func notificationTitle(action string) string {
	switch action {
	case "organization_approved":
		return "Organisation validée"
	case "organization_rejected", "organization_deleted":
		return "Organisation refusée"
	case "event_approved":
		return "Événement validé"
	case "event_rejected":
		return "Événement refusé"
	case "event_hidden":
		return "Événement suspendu"
	case "event_deleted":
		return "Événement supprimé"
	case "account_suspended":
		return "Compte suspendu"
	case "account_restored", "event_restored":
		return "Suspension levée"
	default:
		return "Décision de modération"
	}
}

func notificationMessage(action string, reason string) string {
	reason = strings.TrimSpace(reason)

	switch action {
	case "organization_approved":
		return "Votre organisation a été validée. Elle peut maintenant être visible sur Mappening."
	case "organization_rejected", "organization_deleted":
		return messageWithOptionalReason("Votre demande d'organisation a été refusée.", reason)
	case "event_approved":
		return "Votre événement a été validé et publié sur Mappening."
	case "event_rejected":
		return messageWithOptionalReason("Votre événement a été refusé par l'équipe de modération.", reason)
	case "event_hidden":
		return messageWithOptionalReason("Votre événement a été temporairement masqué.", reason)
	case "event_deleted":
		return messageWithOptionalReason("Votre événement a été supprimé.", reason)
	case "account_suspended":
		return messageWithOptionalReason("Votre compte a été temporairement suspendu.", reason)
	case "account_restored", "event_restored":
		return messageWithOptionalReason("La suspension a été levée.", reason)
	default:
		return messageWithOptionalReason("Une décision de modération a été appliquée.", reason)
	}
}

func messageWithOptionalReason(message string, reason string) string {
	if reason == "" {
		return message
	}
	return message + " Motif : " + reason
}

func actionURL(targetType string, targetID int64) string {
	switch targetType {
	case "event":
		return "/"
	case "organization":
		return fmt.Sprintf("/organizations/%d", targetID)
	default:
		return "/profile"
	}
}

func (r *Repository) notificationEmail(recipient notificationRecipient, title string, reason string, actionPath string) mailer.Message {
	link := actionPath
	if r.frontendURL != "" && strings.HasPrefix(actionPath, "/") {
		link = r.frontendURL + actionPath
	}

	body := strings.Join([]string{
		"Bonjour " + recipient.Name + ",",
		"",
		title,
		"",
		reason,
		"",
		"Consulter dans Mappening : " + link,
	}, "\n")

	return mailer.Message{
		To:      recipient.Email,
		Subject: title + " - Mappening",
		Text:    body,
	}
}

func (r *Repository) sendActionEmails(messages []mailer.Message) {
	if r.mailSender == nil || len(messages) == 0 {
		return
	}

	for _, message := range messages {
		message := message
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			if err := r.mailSender.Send(ctx, message); err != nil {
				logActionMailError(message.To, err)
			}
		}()
	}
}

func logActionMailError(to string, err error) {
	log.Error().
		Err(err).
		Str("to", to).
		Str("purpose", "moderation notification").
		Msg("mail delivery failed")
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func nullableTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func nullableInt(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func nullableFloat(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
}

func splitCSV(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return []string{}
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
