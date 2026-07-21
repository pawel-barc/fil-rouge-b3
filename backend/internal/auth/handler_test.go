package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"mappening/internal/contracts"
	"mappening/internal/http/middleware"
	"mappening/internal/users"
)

type fakeAuthUserRepo struct {
	user *users.User
}

func (f fakeAuthUserRepo) GetByEmail(_ context.Context, email string) (*users.User, error) {
	if f.user == nil || f.user.Email != email {
		return nil, users.ErrUserNotFound
	}
	return f.user, nil
}

func (f fakeAuthUserRepo) Login(_ context.Context, email, password string) (*users.User, error) {
	user, err := f.GetByEmail(context.Background(), email)
	if err != nil {
		return nil, err
	}
	if !isUserAllowedToAuthenticate(user) {
		return nil, ErrUserInactive
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}
	return user, nil
}

type fakeOrganizationRegistrationRepo struct {
	fakeAuthUserRepo
	called bool
}

func (f *fakeOrganizationRegistrationRepo) CreateOrganization(_ context.Context, _ users.OrganizationRegistration) (*users.User, int64, error) {
	f.called = true
	return &users.User{
		ID:          42,
		AccountID:   42,
		ProfileID:   7,
		Email:       "org@mappening.local",
		FirstName:   "Org Owner",
		Role:        "organization",
		AccountType: "organization",
		IsActive:    true,
	}, 12, nil
}

func (f *fakeOrganizationRegistrationRepo) RegisterOrganization(
	_ context.Context,
	req contracts.RegisterOrganizationRequestDTO,
	_ normalizedOrganizationAddress,
) (*users.User, int64, error) {
	if err := validateOrganizationRegistrationFields(req); err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrInvalidRegistration, err)
	}

	f.called = true
	return &users.User{
		ID:          42,
		AccountID:   42,
		ProfileID:   7,
		Email:       "org@mappening.local",
		FirstName:   "Org Owner",
		Role:        "organization",
		AccountType: "organization",
		IsActive:    true,
	}, 12, nil
}

func makeTestAuthUser(t *testing.T) *users.User {
	t.Helper()

	hash, err := bcrypt.GenerateFromPassword([]byte("admin1234"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	return &users.User{
		ID:           1,
		Email:        "admin@mappening.local",
		PasswordHash: string(hash),
		FirstName:    "Admin",
		LastName:     "Mappening",
		Role:         "admin",
		IsActive:     true,
	}
}

func TestAuthHandler_Login_OK_SetsCookies_AndStore(t *testing.T) {
	store := NewRefreshStore()
	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service:      fakeAuthUserRepo{user: makeTestAuthUser(t)},
	}

	body := map[string]string{"email": "admin@mappening.local", "password": "admin1234"}
	b, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	h.Login(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}

	var payload struct {
		OK   bool `json:"ok"`
		User struct {
			Email string `json:"email"`
			Role  string `json:"role"`
		} `json:"user"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode login payload: %v", err)
	}
	if !payload.OK || payload.User.Email != "admin@mappening.local" || payload.User.Role != "admin" {
		t.Fatalf("unexpected login payload: %+v", payload)
	}
	csrfHeader := res.Header.Get("X-CSRF-Token")
	if csrfHeader == "" {
		t.Fatalf("expected csrf response header")
	}

	cookies := res.Cookies()
	if findCookie(cookies, "access_token") == nil {
		t.Fatalf("expected access_token cookie")
	}
	if findCookie(cookies, "refresh_token") == nil {
		t.Fatalf("expected refresh_token cookie")
	}
	csrfCookie := findCookie(cookies, "csrf_token")
	if csrfCookie == nil {
		t.Fatalf("expected csrf_token cookie")
	}
	if csrfCookie.Value != csrfHeader {
		t.Fatalf("expected csrf cookie to match response header")
	}

	// Le store doit contenir un JTI pour le subject
	if _, ok, err := store.Get("admin@mappening.local"); err != nil || !ok {
		t.Fatalf("expected refresh store to be set for subject")
	}
}

func TestToAuthUserDTO_IncludesAccountAndProfileIDs(t *testing.T) {
	createdAt := time.Date(2026, time.January, 15, 9, 30, 0, 0, time.FixedZone("CET", 3600))
	user := &users.User{
		ID:             42,
		AccountID:      42,
		ProfileID:      7,
		OrganizationID: 12,
		Email:          "user@mappening.local",
		FirstName:      "User",
		Role:           "organization",
		AccountType:    "organization",
		IsActive:       true,
		CreatedAt:      createdAt,
	}

	dto := toAuthUserDTO(user)

	if dto.ID != 42 || dto.AccountID != 42 || dto.UserID != 7 {
		t.Fatalf("unexpected auth ids: %+v", dto)
	}
	if dto.OrganizationID == nil || *dto.OrganizationID != 12 {
		t.Fatalf("expected organization id in auth dto, got %+v", dto)
	}
	if dto.CreatedAt != "2026-01-15T08:30:00Z" {
		t.Fatalf("expected created_at in auth dto, got %+v", dto)
	}
}

func TestAuthHandler_RegisterOrganization_RejectsTooLongLogo(t *testing.T) {
	store := NewRefreshStore()
	repo := &fakeOrganizationRegistrationRepo{}
	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service:      repo,
	}

	body := map[string]any{
		"login_email":          "org@mappening.local",
		"password":             "Password123!",
		"member_name":          "Org Owner",
		"member_job_role":      "Responsable",
		"name":                 "Organisation Test",
		"contact_email":        "contact-org@mappening.local",
		"description":          "Une organisation de test.",
		"website":              "",
		"address":              "1 rue du Test",
		"city":                 "Paris",
		"postal_code":          "75001",
		"logo":                 "data:image/png;base64," + strings.Repeat("a", 260),
		"contact_phone_number": "",
		"siret":                "",
		"category_slugs":       []string{"art"},
	}
	b, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/register/organization", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	h.RegisterOrganization(rec, req)

	if rec.Result().StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Result().StatusCode)
	}
	if repo.called {
		t.Fatalf("expected invalid registration to be rejected before repository call")
	}

	var payload map[string]string
	if err := json.NewDecoder(rec.Result().Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["error"] != "Le logo est trop long" {
		t.Fatalf("expected logo length error, got %+v", payload)
	}
}

func TestAuthHandler_Login_InvalidCredentials_401(t *testing.T) {
	store := NewRefreshStore()
	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service:      fakeAuthUserRepo{user: makeTestAuthUser(t)},
	}

	body := map[string]string{"email": "admin@mappening.local", "password": "wrong"}
	b, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	h.Login(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.StatusCode)
	}
}

func TestAuthHandler_Login_InactiveUser_StillReturnsGenericUnauthorized(t *testing.T) {
	store := NewRefreshStore()
	inactiveUser := makeTestAuthUser(t)
	inactiveUser.IsActive = false

	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service:      fakeAuthUserRepo{user: inactiveUser},
	}

	body := map[string]string{"email": "admin@mappening.local", "password": "admin1234"}
	b, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	h.Login(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.StatusCode)
	}

	var payload map[string]string
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload["error"] != "Email ou mot de passe incorrect" {
		t.Fatalf("expected generic invalid credentials error, got %+v", payload)
	}
}

func TestAuthHandler_Login_SuspendedUser_StillReturnsGenericUnauthorized(t *testing.T) {
	store := NewRefreshStore()
	suspendedUser := makeTestAuthUser(t)
	suspendedUntil := time.Now().Add(time.Hour)
	suspendedUser.SuspendedUntil = &suspendedUntil

	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service:      fakeAuthUserRepo{user: suspendedUser},
	}

	body := map[string]string{"email": "admin@mappening.local", "password": "admin1234"}
	b, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	h.Login(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.StatusCode)
	}

	var payload map[string]string
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload["error"] != "Email ou mot de passe incorrect" {
		t.Fatalf("expected generic invalid credentials error, got %+v", payload)
	}
}

func TestAuthHandler_Refresh_RotatesRefreshCookie_AndStore(t *testing.T) {
	store := NewRefreshStore()
	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service:      fakeAuthUserRepo{user: makeTestAuthUser(t)},
	}

	// 1) Login pour obtenir un refresh_token cohérent + store initialisé
	{
		body := map[string]string{"email": "admin@mappening.local", "password": "admin1234"}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost:5173")
		rec := httptest.NewRecorder()

		h.Login(rec, req)
		res := rec.Result()
		res.Body.Close()

		if res.StatusCode != 200 {
			t.Fatalf("login expected 200, got %d", res.StatusCode)
		}
	}

	oldJTI, ok, err := store.Get("admin@mappening.local")
	if err != nil || !ok || oldJTI == "" {
		t.Fatalf("expected old JTI set in store")
	}

	// 2) Refresh en réutilisant le refresh_token cookie du login
	var refreshCookie *http.Cookie
	{
		// Refaire un login pour récupérer le cookie dans un recorder (simple)
		body := map[string]string{"email": "admin@mappening.local", "password": "admin1234"}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost:5173")
		rec := httptest.NewRecorder()

		h.Login(rec, req)
		res := rec.Result()
		res.Body.Close()

		refreshCookie = findCookie(res.Cookies(), "refresh_token")
		if refreshCookie == nil {
			t.Fatalf("expected refresh_token cookie from login")
		}
	}

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req2.Header.Set("Origin", "http://localhost:5173")
	req2.AddCookie(refreshCookie)

	h.Refresh(rec2, req2)
	res2 := rec2.Result()
	defer res2.Body.Close()

	if res2.StatusCode != 200 {
		t.Fatalf("expected 200 on refresh, got %d", res2.StatusCode)
	}

	var payload struct {
		OK bool `json:"ok"`
	}
	if err := json.NewDecoder(res2.Body).Decode(&payload); err != nil {
		t.Fatalf("decode refresh payload: %v", err)
	}
	if !payload.OK {
		t.Fatalf("expected successful refresh payload, got %+v", payload)
	}
	csrfHeader := res2.Header.Get("X-CSRF-Token")
	if csrfHeader == "" {
		t.Fatalf("expected csrf response header")
	}
	csrfCookie := findCookie(res2.Cookies(), "csrf_token")
	if csrfCookie == nil {
		t.Fatalf("expected csrf_token cookie on refresh response")
	}
	if csrfCookie.Value != csrfHeader {
		t.Fatalf("expected csrf cookie to match response header")
	}

	newRefresh := findCookie(res2.Cookies(), "refresh_token")
	if newRefresh == nil {
		t.Fatalf("expected refresh_token cookie on refresh response")
	}
	if newRefresh.Value == refreshCookie.Value {
		t.Fatalf("expected refresh cookie rotation (different value)")
	}

	newJTI, ok, err := store.Get("admin@mappening.local")
	if err != nil || !ok {
		t.Fatalf("expected store to contain subject after refresh")
	}
	if newJTI == oldJTI {
		t.Fatalf("expected store JTI to rotate (different value)")
	}
}

func TestAuthHandler_Refresh_RejectsStaleSessionRevision(t *testing.T) {
	store := NewRefreshStore()
	user := makeTestAuthUser(t)
	issuedAt := user.UpdatedAt

	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service: fakeAuthUserRepo{user: &users.User{
			ID:           user.ID,
			Email:        user.Email,
			PasswordHash: user.PasswordHash,
			FirstName:    user.FirstName,
			LastName:     user.LastName,
			Role:         "user",
			IsActive:     true,
			UpdatedAt:    issuedAt.Add(time.Minute),
		}},
	}

	if err := store.SetWithExpiry(user.Email, "refresh-jti", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("seed refresh store: %v", err)
	}

	claims := middleware.UserClaims{
		UserID:          user.ID,
		Email:           user.Email,
		Role:            user.Role,
		SessionRevision: issuedAt.UTC().UnixMicro(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "mappening",
			Subject:   user.Email,
			Audience:  []string{"refresh"},
			ID:        "refresh-jti",
			IssuedAt:  jwt.NewNumericDate(issuedAt),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedToken, err := token.SignedString([]byte(h.Secret))
	if err != nil {
		t.Fatalf("sign refresh token: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.AddCookie(&http.Cookie{Name: "refresh_token", Value: signedToken})
	rec := httptest.NewRecorder()

	h.Refresh(rec, req)

	if rec.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Result().StatusCode)
	}
}

func TestAuthHandler_DevLogin_OK_FromLoopback(t *testing.T) {
	store := NewRefreshStore()
	h := Handler{
		Secret:          "test-secret",
		Issuer:          "mappening",
		AccessTTL:       10 * time.Second,
		RefreshTTL:      7 * 24 * time.Hour,
		CookieSecure:    false,
		Env:             "dev",
		FrontendURL:     "http://localhost:5173",
		DevLoginEnabled: true,
		DevLoginEmail:   "admin@mappening.local",
		Store:           store,
		Service:         fakeAuthUserRepo{user: makeTestAuthUser(t)},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login/dev", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.RemoteAddr = "127.0.0.1:12345"
	req.Host = "localhost:8080"
	rec := httptest.NewRecorder()

	h.DevLogin(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}

	if findCookie(res.Cookies(), "access_token") == nil {
		t.Fatalf("expected access_token cookie")
	}
	if findCookie(res.Cookies(), "refresh_token") == nil {
		t.Fatalf("expected refresh_token cookie")
	}
	if _, ok, err := store.Get("admin@mappening.local"); err != nil || !ok {
		t.Fatalf("expected refresh store to be set for subject")
	}
}

func TestAuthHandler_DevLogin_RejectsSuspendedUser(t *testing.T) {
	store := NewRefreshStore()
	suspendedUser := makeTestAuthUser(t)
	suspendedUntil := time.Now().Add(time.Hour)
	suspendedUser.SuspendedUntil = &suspendedUntil

	h := Handler{
		Secret:          "test-secret",
		Issuer:          "mappening",
		AccessTTL:       10 * time.Second,
		RefreshTTL:      7 * 24 * time.Hour,
		CookieSecure:    false,
		Env:             "dev",
		FrontendURL:     "http://localhost:5173",
		DevLoginEnabled: true,
		DevLoginEmail:   "admin@mappening.local",
		Store:           store,
		Service:         fakeAuthUserRepo{user: suspendedUser},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login/dev", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.RemoteAddr = "127.0.0.1:12345"
	req.Host = "localhost:8080"
	rec := httptest.NewRecorder()

	h.DevLogin(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", res.StatusCode)
	}
	if findCookie(res.Cookies(), "access_token") != nil {
		t.Fatalf("did not expect access_token cookie")
	}
	if _, ok, err := store.Get("admin@mappening.local"); err != nil || ok {
		t.Fatalf("did not expect refresh store to be set for suspended user")
	}
}

func TestAuthHandler_DevLogin_RejectsNonLoopback(t *testing.T) {
	store := NewRefreshStore()
	h := Handler{
		Secret:          "test-secret",
		Issuer:          "mappening",
		AccessTTL:       10 * time.Second,
		RefreshTTL:      7 * 24 * time.Hour,
		CookieSecure:    false,
		Env:             "dev",
		FrontendURL:     "http://localhost:5173",
		DevLoginEnabled: true,
		DevLoginEmail:   "admin@mappening.local",
		Store:           store,
		Service:         fakeAuthUserRepo{user: makeTestAuthUser(t)},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login/dev", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.RemoteAddr = "192.0.2.10:12345"
	req.Host = "localhost:8080"
	rec := httptest.NewRecorder()

	h.DevLogin(rec, req)
	res := rec.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", res.StatusCode)
	}
}

func TestAuthHandler_DevLogin_RejectsNonLoopbackHost(t *testing.T) {
	store := NewRefreshStore()
	h := Handler{
		Secret:          "test-secret",
		Issuer:          "mappening",
		AccessTTL:       10 * time.Second,
		RefreshTTL:      7 * 24 * time.Hour,
		CookieSecure:    false,
		Env:             "dev",
		FrontendURL:     "http://localhost:5173",
		DevLoginEnabled: true,
		DevLoginEmail:   "admin@mappening.local",
		Store:           store,
		Service:         fakeAuthUserRepo{user: makeTestAuthUser(t)},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login/dev", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.RemoteAddr = "127.0.0.1:12345"
	req.Host = "dev.example.test"
	rec := httptest.NewRecorder()

	h.DevLogin(rec, req)

	if rec.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Result().StatusCode)
	}
}

func TestAuthHandler_Login_RejectsInvalidOrigin(t *testing.T) {
	store := NewRefreshStore()
	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service:      fakeAuthUserRepo{user: makeTestAuthUser(t)},
	}

	body := map[string]string{"email": "admin@mappening.local", "password": "admin1234"}
	b, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://attacker.example")
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Result().StatusCode)
	}
}

func TestAuthHandler_Login_RejectsNonJSONContentType(t *testing.T) {
	store := NewRefreshStore()
	h := Handler{
		Secret:       "test-secret",
		Issuer:       "mappening",
		AccessTTL:    10 * time.Second,
		RefreshTTL:   7 * 24 * time.Hour,
		CookieSecure: false,
		FrontendURL:  "http://localhost:5173",
		Store:        store,
		Service:      fakeAuthUserRepo{user: makeTestAuthUser(t)},
	}

	body := `{"email":"admin@mappening.local","password":"admin1234"}`

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Result().StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d", rec.Result().StatusCode)
	}
}
