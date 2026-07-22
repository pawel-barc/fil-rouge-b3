package contracts

type AuthUserDTO struct {
	ID               int64   `json:"id"`
	AccountID        int64   `json:"account_id"`
	UserID           int64   `json:"user_id,omitempty"`
	Email            string  `json:"email"`
	LoginEmail       string  `json:"login_email"`
	FirstName        string  `json:"first_name"`
	LastName         string  `json:"last_name"`
	Username         string  `json:"username"`
	Role             string  `json:"role"`
	AccountType      string  `json:"account_type"`
	IsActive         bool    `json:"is_active"`
	SuspendedUntil   *string `json:"suspended_until,omitempty"`
	SuspensionReason *string `json:"suspension_reason,omitempty"`
	CreatedAt        string  `json:"created_at,omitempty"`
	OrganizationID   *int64  `json:"organization_id,omitempty"`
}

type LoginRequestDTO struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponseDTO struct {
	OK   bool        `json:"ok"`
	User AuthUserDTO `json:"user"`
}

type RegisterUserRequestDTO struct {
	LoginEmail    string   `json:"login_email"`
	Email         string   `json:"email"`
	Username      string   `json:"username"`
	Password      string   `json:"password"`
	CategorySlugs []string `json:"category_slugs"`
}

type RegisterOrganizationRequestDTO struct {
	LoginEmail         string   `json:"login_email"`
	Email              string   `json:"email"`
	Password           string   `json:"password"`
	MemberName         string   `json:"member_name"`
	MemberJobRole      string   `json:"member_job_role"`
	Name               string   `json:"name"`
	ContactEmail       string   `json:"contact_email"`
	Description        string   `json:"description"`
	Website            string   `json:"website"`
	Address            string   `json:"address"`
	City               string   `json:"city"`
	PostalCode         string   `json:"postal_code"`
	Logo               string   `json:"logo"`
	ContactPhoneNumber string   `json:"contact_phone_number"`
	SIRET              string   `json:"siret"`
	CategorySlugs      []string `json:"category_slugs"`
}

type ChangePasswordRequestDTO struct {
	CurrentPassword string `json:"current_password"`
	OldPassword     string `json:"old_password"`
	NewPassword     string `json:"new_password"`
}

type UpdateProfileRequestDTO struct {
	LoginEmail string `json:"login_email"`
	Email      string `json:"email"`
	Username   string `json:"username"`
}

type ForgotPasswordRequestDTO struct {
	LoginEmail string `json:"login_email"`
	Email      string `json:"email"`
}

type ForgotPasswordResponseDTO struct {
	OK        bool   `json:"ok"`
	Message   string `json:"message"`
	ResetURL  string `json:"reset_url,omitempty"`
	ResetLink string `json:"resetLink,omitempty"`
}

type ResetPasswordRequestDTO struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
	Password    string `json:"password"`
}

type ReplacePreferencesRequestDTO struct {
	CategorySlugs []string `json:"category_slugs"`
}

type AuthCheckResponseDTO struct {
	OK      bool   `json:"ok"`
	Allowed bool   `json:"allowed"`
	Actual  string `json:"actual"`
}
