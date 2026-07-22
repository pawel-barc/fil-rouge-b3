package scraping

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

type Scheduler struct {
	db             *sql.DB
	location       *time.Location
	userAgent      string
	mediaUploadDir string
	stop           chan struct{}
	done           chan struct{}
	once           sync.Once
}

func NewScheduler(db *sql.DB, location *time.Location, userAgent string, mediaUploadDir string) *Scheduler {
	if location == nil {
		location = time.Local
	}
	return &Scheduler{
		db:             db,
		location:       location,
		userAgent:      userAgent,
		mediaUploadDir: mediaUploadDir,
		stop:           make(chan struct{}),
		done:           make(chan struct{}),
	}
}

func (s *Scheduler) Start() {
	go s.loop()
}

func (s *Scheduler) Stop() {
	s.once.Do(func() {
		close(s.stop)
		<-s.done
	})
}

func (s *Scheduler) loop() {
	defer close(s.done)

	s.runOnce()
	for {
		timer := time.NewTimer(time.Until(nextDailyRun(time.Now().In(s.location), 1, 0)))
		select {
		case <-s.stop:
			timer.Stop()
			return
		case <-timer.C:
			s.runOnce()
		}
	}
}

func (s *Scheduler) runOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	stats, err := NewTarpinBienServiceWithUploadDir(s.db, s.userAgent, s.mediaUploadDir).Run(ctx)
	if err != nil {
		log.Error().Err(err).Msg("scheduled tarpin bien scraping failed")
		return
	}
	log.Info().
		Int("search_pages", stats.SearchPagesVisited).
		Int("events_found", stats.EventsFound).
		Int("detail_pages", stats.DetailPagesVisited).
		Int("created", stats.Inserted).
		Int("updated", stats.Updated).
		Int("unchanged", stats.SkippedUnchanged).
		Int("invalid", stats.SkippedInvalid).
		Int("images_downloaded", stats.ImagesDownloaded).
		Int("image_errors", stats.ImageErrors).
		Int("errors", stats.Errors).
		Dur("duration", stats.Duration).
		Msg("scheduled tarpin bien scraping completed")
}

func nextDailyRun(now time.Time, hour int, minute int) time.Time {
	next := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, now.Location())
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	return next
}
