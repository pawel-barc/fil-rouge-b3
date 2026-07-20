package http

import (
	"context"
	"database/sql"
	nethttp "net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/rs/zerolog/log"

	"mappening/internal/auth"
	"mappening/internal/cache"
	"mappening/internal/config"
	"mappening/internal/events"
	"mappening/internal/geocoding"
	"mappening/internal/http/middleware"
	"mappening/internal/mailer"
	"mappening/internal/media"
	"mappening/internal/organizations"
	"mappening/internal/staff"
	"mappening/internal/users"
)

// NewRouter construit le routeur backend minimal: auth, users admin et health.
func NewRouter(cfg config.Config, db *sql.DB, cache *cache.Client) nethttp.Handler {
	var store auth.RefreshTokenStore = auth.NewRefreshStore()

	var userRepo *users.Repository
	var authService authUserReader

	if db != nil {
		dbStore, err := auth.NewDBRefreshStore(db)
		if err != nil {
			log.Error().Err(err).Msg("failed to initialize database refresh store")
		} else {
			store = dbStore
		}

		userRepo = users.NewRepository(db)
		authService = auth.NewAuthService(userRepo)
	}

	var adminService users.AdminService
	if userRepo != nil {
		adminService = users.NewAdminService(userRepo, store)
	}
	adminUsersHandler := users.AdminHandler{
		Service: adminService,
	}

	return newRouter(cfg, db, store, authService, adminUsersHandler, geocoding.NewClient(), cache)
}

type authUserReader interface {
	GetByEmail(ctx context.Context, email string) (*users.User, error)
}

func cachedUploadsHandler(rootDir string) nethttp.Handler {
	fileServer := nethttp.StripPrefix("/uploads/", nethttp.FileServer(nethttp.Dir(rootDir)))
	return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		fileServer.ServeHTTP(w, r)
	})
}

func newRouter(
	cfg config.Config,
	db *sql.DB,
	store auth.RefreshTokenStore,
	authService authUserReader,
	adminUsers users.AdminHandler,
	geocoder geocoding.Normalizer,
	cache *cache.Client,
) nethttp.Handler {
	r := chi.NewRouter()

	loginRateLimiter := middleware.NewDBRateLimiter(db, 20, time.Minute, cfg.TrustedProxyCIDRs...)
	registerRateLimiter := middleware.NewDBRateLimiter(db, 10, time.Minute, cfg.TrustedProxyCIDRs...)
	passwordRateLimiter := middleware.NewDBRateLimiter(db, 5, time.Minute, cfg.TrustedProxyCIDRs...)
	loginAccountRateLimiter := middleware.NewDBRateLimiterWithKeyBuilder(
		db,
		5,
		15*time.Minute,
		middleware.LoginEmailRateLimitKey(8<<10),
	)
	loginGlobalAccountRateLimiter := middleware.NewDBRateLimiterWithKeyBuilder(
		db,
		20,
		15*time.Minute,
		middleware.LoginEmailOnlyRateLimitKey(8<<10),
	)
	refreshRateLimiter := middleware.NewDBRateLimiter(db, 20, time.Minute, cfg.TrustedProxyCIDRs...)
	adminWriteRateLimiter := middleware.NewDBRateLimiter(db, 60, time.Minute, cfg.TrustedProxyCIDRs...)
	geocodingRateLimiter := middleware.NewDBRateLimiter(db, 60, time.Minute, cfg.TrustedProxyCIDRs...)

	r.Use(middleware.RequestID())
	r.Use(middleware.AccessLog(cfg.TrustedProxyCIDRs...))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.FrontendURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"X-CSRF-Token", middleware.RequestIDHeader},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	r.Use(middleware.SecurityHeaders(cfg.TrustedProxyCIDRs...))
	r.Use(chimiddleware.Recoverer)

	r.Use(middleware.CsrfProtect(middleware.CsrfOptions{
		CookieName: "csrf_token",
		HeaderName: "X-CSRF-Token",
		SkipPaths: []string{
			"/api/auth/login",
			"/api/auth/login/dev",
			"/api/auth/register/user",
			"/api/auth/register/organization",
			"/api/auth/refresh",
			"/api/auth/password/forgot",
			"/api/auth/password/reset",
		},
		FrontendURL: cfg.FrontendURL,
	}))

	r.Handle("/uploads/*", cachedUploadsHandler(cfg.MediaUploadDir))
	if cfg.PublicDocsEnabled {
		r.Get("/openapi.yaml", openAPIHandler)
		r.Get("/swagger", func(w nethttp.ResponseWriter, r *nethttp.Request) {
			nethttp.Redirect(w, r, "/swagger/", nethttp.StatusMovedPermanently)
		})
		r.Get("/swagger/", swaggerUIHandler)
	}

	authHandler := auth.Handler{
		Secret:           cfg.JWTSecret,
		Issuer:           cfg.JWTIssuer,
		AccessTTL:        cfg.JWTTTL,
		RefreshTTL:       cfg.RefreshTTL,
		CookieSecure:     cfg.CookieSecure,
		CSRFCookieDomain: cfg.CSRFCookieDomain,
		Env:              cfg.Env,
		FrontendURL:      cfg.FrontendURL,
		DevLoginEnabled:  cfg.DevLoginEnabled,
		DevLoginEmail:    cfg.DevLoginEmail,
		Store:            store,
		Service:          authService,
		Geocoder:         geocoder,
		Mailer:           mailer.NewSender(cfg.Mail),
	}

	geocodingSuggester, _ := geocoder.(geocoding.Suggester)
	geocoding.RegisterRoutes(r.With(geocodingRateLimiter.Handler()), geocoding.Handler{
		Suggester: geocodingSuggester,
		Cache:     geocoding.NewSuggestionCache(cache),
	})

	if db != nil {
		organizations.RegisterRoutes(
			r,
			organizations.Handler{
				Service: organizations.Service{
					Repo: organizations.NewRepository(db),
				},
				Geocoder: geocoder,
			},
			middleware.AuthJWTWithUserLookup(cfg.JWTSecret, cfg.JWTIssuer, cfg.Env, authService),
		)

		events.RegisterRoutes(
			r,
			events.Handler{
				Service:  events.Service{Repo: events.NewRepository(db, cache)},
				Geocoder: geocoder,
			},
			middleware.AuthJWTWithUserLookup(cfg.JWTSecret, cfg.JWTIssuer, cfg.Env, authService),
		)

		media.RegisterRoutes(
			r,
			media.Handler{
				Service: media.Service{
					Repo:    media.NewRepository(db),
					Storage: media.NewLocalStorage(cfg.MediaUploadDir),
				},
			},
			middleware.AuthJWTWithUserLookup(cfg.JWTSecret, cfg.JWTIssuer, cfg.Env, authService),
		)

		staff.RegisterRoutes(
			r,
			staff.Handler{
				Service: staff.Service{
					Repo: staff.NewRepositoryWithMailer(db, mailer.NewSender(cfg.Mail), cfg.FrontendURL),
				},
			},
			middleware.AuthJWTWithUserLookup(cfg.JWTSecret, cfg.JWTIssuer, cfg.Env, authService),
		)
	}

	r.Get("/api/health", func(w nethttp.ResponseWriter, r *nethttp.Request) {
		w.WriteHeader(nethttp.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	r.With(
		middleware.NoStore(),
		loginRateLimiter.Handler(),
		loginAccountRateLimiter.Handler(),
		loginGlobalAccountRateLimiter.Handler(),
	).Post("/api/auth/login", authHandler.Login)
	r.With(middleware.NoStore(), loginRateLimiter.Handler()).Post("/api/auth/login/dev", authHandler.DevLogin)
	r.With(middleware.NoStore(), registerRateLimiter.Handler()).Post("/api/auth/register/user", authHandler.RegisterUser)
	r.With(middleware.NoStore(), registerRateLimiter.Handler()).Post("/api/auth/register/organization", authHandler.RegisterOrganization)
	r.With(middleware.NoStore(), passwordRateLimiter.Handler()).Post("/api/auth/password/forgot", authHandler.ForgotPassword)
	r.With(middleware.NoStore(), passwordRateLimiter.Handler()).Post("/api/auth/password/reset", authHandler.ResetPassword)
	r.With(middleware.NoStore(), refreshRateLimiter.Handler()).Post("/api/auth/refresh", authHandler.Refresh)

	r.Group(func(pr chi.Router) {
		pr.Use(middleware.NoStore())
		pr.Use(middleware.AuthJWTWithUserLookup(cfg.JWTSecret, cfg.JWTIssuer, cfg.Env, authService))

		pr.Post("/api/auth/logout", authHandler.Logout)
		pr.Get("/api/auth/me", authHandler.Me)
		pr.Patch("/api/auth/profile", authHandler.UpdateProfile)
		pr.Patch("/api/auth/password", authHandler.ChangePassword)
		pr.Get("/api/auth/check-role/{role}", authHandler.CheckRole)
		pr.Get("/api/auth/check-account-type/{accountType}", authHandler.CheckAccountType)
		pr.Patch("/api/auth/deactivate", authHandler.DeactivateAccount)
		pr.Delete("/api/auth/account", authHandler.DeleteAccount)
		pr.Get("/api/me/preferences", authHandler.ListPreferences)
		pr.Put("/api/me/preferences", authHandler.ReplacePreferences)
		pr.Get("/api/notification-types", authHandler.ListNotificationTypes)
		pr.Get("/api/me/notifications", authHandler.ListNotifications)
		pr.Patch("/api/me/notifications/read", authHandler.MarkAllNotificationsRead)
		pr.Patch("/api/me/notifications/{notificationID}/read", authHandler.MarkNotificationRead)

		pr.Group(func(ar chi.Router) {
			ar.Use(middleware.RequireRole("admin"))

			ar.Get("/api/admin/users", adminUsers.List)
			ar.With(adminWriteRateLimiter.Handler()).Post("/api/admin/users", adminUsers.Create)
			ar.With(adminWriteRateLimiter.Handler()).Patch("/api/admin/users/{userID}", adminUsers.Update)
			ar.With(adminWriteRateLimiter.Handler()).Delete("/api/admin/users/{userID}", adminUsers.Delete)
			ar.With(adminWriteRateLimiter.Handler()).Post("/api/admin/users/{userID}/reset-password", adminUsers.ResetPassword)
			ar.Get("/api/health/db", func(w nethttp.ResponseWriter, r *nethttp.Request) {
				if db == nil {
					nethttp.Error(w, "db down", nethttp.StatusServiceUnavailable)
					return
				}
				if err := db.PingContext(r.Context()); err != nil {
					nethttp.Error(w, "db down", nethttp.StatusServiceUnavailable)
					return
				}

				w.WriteHeader(nethttp.StatusOK)
				_, _ = w.Write([]byte("db ok"))
			})
		})
	})

	_ = chi.Walk(r, func(method string, route string, handler nethttp.Handler, middlewares ...func(nethttp.Handler) nethttp.Handler) error {
		log.Info().
			Str("method", method).
			Str("route", route).
			Msg("registered route")
		return nil
	})

	return r
}
