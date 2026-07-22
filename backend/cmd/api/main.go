package main

import (
	"database/sql"
	"net/http"
	"os"
	"time"

	"mappening/internal/cache"
	"mappening/internal/config"
	dbx "mappening/internal/db"
	httpx "mappening/internal/http"
	"mappening/internal/logger"
	"mappening/internal/scraping"

	"github.com/rs/zerolog/log"
)

func main() {
	if err := config.LoadLocalDotEnvFiles(); err != nil {
		log.Error().Err(err).Msg("failed to load local dotenv files")
		os.Exit(1)
	}
	logger.Init(os.Stdout)

	cfg := config.Load()

	if err := cfg.ValidateAPI(); err != nil {
		log.Error().Err(err).Msg("invalid API configuration")
		os.Exit(1)
	}

	db, err := dbx.New(cfg.AppDB)
	if err != nil {
		log.Error().Err(err).Msg("database connection failed")
		os.Exit(1)
	}
	defer closeDB(db)

	log.Info().Msg("application database connected")
	redisClient, err := cache.New(cfg.Redis)
	if err != nil {
		log.Error().Err(err).Msg("redis connection failed")
		os.Exit(1)
	}
	defer func() {
		if err := redisClient.Close(); err != nil {
			log.Error().Err(err).Msg("failed to close redis")
		}
	}()

	log.Info().Msg("redis connected")

	var scraperScheduler *scraping.Scheduler
	if cfg.TarpinBienScraperEnabled {
		location, err := time.LoadLocation("Europe/Paris")
		if err != nil {
			log.Warn().Err(err).Msg("failed to load Europe/Paris timezone, using local timezone")
			location = time.Local
		}
		scraperScheduler = scraping.NewScheduler(db, location, cfg.TarpinBienUserAgent, cfg.MediaUploadDir)
		scraperScheduler.Start()
		defer scraperScheduler.Stop()
		log.Info().Msg("tarpin bien scraper scheduler started")
	}

	h := httpx.NewRouter(cfg, db, redisClient)
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	log.Info().Str("addr", cfg.Addr).Msg("api starting")
	if err := server.ListenAndServe(); err != nil {
		log.Error().Err(err).Msg("server crashed")
		os.Exit(1)
	}
}

func closeDB(db *sql.DB) {
	if err := db.Close(); err != nil {
		log.Error().Err(err).Msg("failed to close database")
	}
}
