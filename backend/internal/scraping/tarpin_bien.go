package scraping

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	TarpinBienSource      = "Le Tarpin Bien"
	tarpinBienSearchURL   = "https://tarpin-bien.com/recherche/?evenementCheck=1"
	addressAPIURL         = "https://data.geopf.fr/geocodage/search"
	eventDateTimeDBLayout = "2006-01-02 15:04:05"
	defaultUserAgent      = "MappeningBot/1.0 (+https://mappening.fr)"
	marseilleLatitude     = 43.2965
	marseilleLongitude    = 5.3698
	maxMarseilleRadiusKM  = 40.0
)

type TarpinBienService struct {
	db         *sql.DB
	httpClient *http.Client
	searchURL  string
	maxPages   int
	userAgent  string
}

type TarpinBienStats struct {
	SearchPagesVisited int
	EventsFound        int
	DetailPagesVisited int
	Inserted           int
	Updated            int
	SkippedUnchanged   int
	SkippedInvalid     int
	ImagesDownloaded   int
	ImageErrors        int
	Errors             int
	Duration           time.Duration
}

type eventPersistenceOutcome string

const (
	eventCreated   eventPersistenceOutcome = "created"
	eventUpdated   eventPersistenceOutcome = "updated"
	eventUnchanged eventPersistenceOutcome = "unchanged"
)

type eventPersistenceResult struct {
	Outcome         eventPersistenceOutcome
	EventID         int64
	ImageDownloaded bool
	ImageCacheHit   bool
	ChangedFields   []string
	UnchangedReason string
}

type existingScrapedEvent struct {
	ID                int64
	Title             string
	Description       string
	StartDate         time.Time
	EndDate           time.Time
	TimeStart         sql.NullString
	TimeEnd           sql.NullString
	Latitude          sql.NullFloat64
	Longitude         sql.NullFloat64
	Address           string
	City              string
	PostalCode        string
	Image             string
	ExternalImageURL  sql.NullString
	ImageOptimizedURL sql.NullString
	ImageThumbnailURL sql.NullString
	Price             sql.NullFloat64
}

type scrapedEvent struct {
	Title             string
	Description       string
	Price             *int
	StartDate         time.Time
	EndDate           time.Time
	TimeStart         *string
	TimeEnd           *string
	Address           string
	City              string
	PostalCode        string
	Latitude          *float64
	Longitude         *float64
	ImageURL          string
	ImageOptimizedURL string
	ImageThumbnailURL string
	SourceURL         string
	CategoryIDs       []int64
}

type eventCategory struct {
	ID   int64
	Name string
	Slug string
}

func eventLocation() *time.Location {
	location, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		return time.Local
	}
	return location
}

func formatEventDateTimeForDB(value time.Time) string {
	return value.In(eventLocation()).Format(eventDateTimeDBLayout)
}

func isWithinMarseilleRadius(latitude, longitude float64) bool {
	return distanceInKilometers(
		marseilleLatitude,
		marseilleLongitude,
		latitude,
		longitude,
	) <= maxMarseilleRadiusKM
}

func distanceInKilometers(fromLatitude, fromLongitude, toLatitude, toLongitude float64) float64 {
	const earthRadiusKM = 6371.0

	fromLatRad := fromLatitude * math.Pi / 180
	toLatRad := toLatitude * math.Pi / 180
	deltaLatRad := (toLatitude - fromLatitude) * math.Pi / 180
	deltaLonRad := (toLongitude - fromLongitude) * math.Pi / 180

	a := math.Sin(deltaLatRad/2)*math.Sin(deltaLatRad/2) +
		math.Cos(fromLatRad)*math.Cos(toLatRad)*
			math.Sin(deltaLonRad/2)*math.Sin(deltaLonRad/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusKM * c
}

func NewTarpinBienService(db *sql.DB) *TarpinBienService {
	return NewTarpinBienServiceWithUserAgent(db, defaultUserAgent)
}

func NewTarpinBienServiceWithUserAgent(db *sql.DB, userAgent string) *TarpinBienService {
	userAgent = strings.TrimSpace(userAgent)
	if userAgent == "" {
		userAgent = defaultUserAgent
	}

	return &TarpinBienService{
		db: db,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
		searchURL: tarpinBienSearchURL,
		maxPages:  50,
		userAgent: userAgent,
	}
}

func (s *TarpinBienService) Run(ctx context.Context) (stats TarpinBienStats, err error) {
	sessionStartedAt := time.Now()
	sessionID := sessionStartedAt.UTC().Format("20060102T150405.000000000Z")
	log.Info().
		Str("session_id", sessionID).
		Str("source", TarpinBienSource).
		Str("search_url", s.searchURL).
		Int("max_search_pages", s.maxPages).
		Msg("tarpin bien scraping session started")
	defer func() {
		stats.Duration = time.Since(sessionStartedAt)
		event := log.Info()
		message := "tarpin bien scraping session finished"
		if err != nil {
			stats.Errors++
			event = log.Error().Err(err).Stack()
			message = "tarpin bien scraping session failed"
		}
		event.
			Str("session_id", sessionID).
			Str("source", TarpinBienSource).
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
			Msg(message)
	}()

	if s.db == nil {
		err = errors.New("scraper database is nil")
		return stats, err
	}
	if err := s.ensureSchema(ctx); err != nil {
		return stats, err
	}

	log.Info().Str("source", TarpinBienSource).Msg("loading scraping categories")
	categories, err := s.loadCategories(ctx)
	if err != nil {
		return stats, err
	}
	log.Info().Str("source", TarpinBienSource).Int("categories", len(categories)).Msg("scraping categories loaded")

	detailURLs, visitedPages, err := s.collectDetailURLs(ctx)
	if err != nil {
		return stats, err
	}

	stats.SearchPagesVisited = visitedPages
	stats.EventsFound = len(detailURLs)
	log.Info().
		Str("source", TarpinBienSource).
		Int("search_pages", stats.SearchPagesVisited).
		Int("events_found", stats.EventsFound).
		Msg("event discovery completed")

	for index, detailURL := range detailURLs {
		select {
		case <-ctx.Done():
			err = ctx.Err()
			return stats, ctx.Err()
		default:
		}

		eventStartedAt := time.Now()
		log.Info().
			Str("source", TarpinBienSource).
			Int("event_index", index+1).
			Int("events_total", len(detailURLs)).
			Str("event_url", detailURL).
			Msg("scraped event processing started")

		event, err := s.scrapeDetail(ctx, detailURL)
		stats.DetailPagesVisited++
		if err != nil {
			stats.Errors++
			stats.SkippedInvalid++
			log.Warn().
				Err(err).
				Str("source", TarpinBienSource).
				Str("event_url", detailURL).
				Str("stage", "detail_scraping").
				Dur("event_duration", time.Since(eventStartedAt)).
				Msg("scraped event ignored after detail scraping error")
			continue
		}
		if event.Latitude == nil || event.Longitude == nil {
			stats.SkippedInvalid++
			log.Warn().
				Str("source", TarpinBienSource).
				Str("event_url", detailURL).
				Str("title", event.Title).
				Str("address", event.Address).
				Str("reason", "missing_coordinates").
				Dur("event_duration", time.Since(eventStartedAt)).
				Msg("scraped event ignored")
			continue
		}
		distanceFromMarseille := distanceInKilometers(
			marseilleLatitude,
			marseilleLongitude,
			*event.Latitude,
			*event.Longitude,
		)
		if !isWithinMarseilleRadius(*event.Latitude, *event.Longitude) {
			stats.SkippedInvalid++
			log.Warn().
				Str("source", TarpinBienSource).
				Str("event_url", detailURL).
				Str("title", event.Title).
				Str("address", event.Address).
				Str("city", event.City).
				Str("postal_code", event.PostalCode).
				Float64("distance_km", distanceFromMarseille).
				Float64("max_distance_km", maxMarseilleRadiusKM).
				Str("reason", "outside_marseille_radius").
				Dur("event_duration", time.Since(eventStartedAt)).
				Msg("scraped event ignored")
			continue
		}
		event.CategoryIDs = bestCategoryIDs(categories, event.Title+" "+event.Description)
		log.Debug().
			Str("source", TarpinBienSource).
			Str("event_url", detailURL).
			Str("title", event.Title).
			Int("category_count", len(event.CategoryIDs)).
			Msg("scraped event categories resolved")

		result, err := s.saveScrapedEvent(ctx, event)
		if err != nil {
			stats.Errors++
			stats.SkippedInvalid++
			if strings.Contains(err.Error(), "image") {
				stats.ImageErrors++
			}
			log.Error().
				Err(err).
				Stack().
				Str("source", TarpinBienSource).
				Str("event_url", detailURL).
				Str("title", event.Title).
				Str("stage", "database_persistence").
				Dur("event_duration", time.Since(eventStartedAt)).
				Msg("failed to persist scraped event")
			continue
		}
		if result.ImageDownloaded {
			stats.ImagesDownloaded++
		}
		switch result.Outcome {
		case eventCreated:
			stats.Inserted++
		case eventUpdated:
			stats.Updated++
		case eventUnchanged:
			stats.SkippedUnchanged++
		}
		log.Info().
			Str("source", TarpinBienSource).
			Str("event_url", detailURL).
			Str("title", event.Title).
			Int64("event_id", result.EventID).
			Str("outcome", string(result.Outcome)).
			Strs("changed_fields", result.ChangedFields).
			Str("reason", result.UnchangedReason).
			Bool("image_downloaded", result.ImageDownloaded).
			Bool("image_cache_hit", result.ImageCacheHit).
			Dur("event_duration", time.Since(eventStartedAt)).
			Msg("scraped event processing completed")

		timer := time.NewTimer(250 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			err = ctx.Err()
			return stats, ctx.Err()
		case <-timer.C:
		}
	}

	return stats, nil
}

func (s *TarpinBienService) ensureSchema(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'events'
		  AND column_name IN ('source_url', 'time_start', 'time_end', 'external_image_url', 'image_optimized_url', 'image_thumbnail_url')
	`)
	if err != nil {
		return fmt.Errorf("check scraper database schema: %w", err)
	}
	defer rows.Close()

	available := map[string]struct{}{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return fmt.Errorf("scan scraper database schema: %w", err)
		}
		available[column] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read scraper database schema: %w", err)
	}

	missing := missingScraperEventColumns(available)
	if len(missing) > 0 {
		return fmt.Errorf("scraper database schema is missing events.%s; run backend migrations with `go run ./cmd/migrate` from the backend directory before starting the scraper", strings.Join(missing, ", events."))
	}

	return nil
}

func missingScraperEventColumns(available map[string]struct{}) []string {
	required := []string{"source_url", "time_start", "time_end", "external_image_url", "image_optimized_url", "image_thumbnail_url"}
	missing := make([]string, 0)
	for _, column := range required {
		if _, ok := available[column]; !ok {
			missing = append(missing, column)
		}
	}
	return missing
}

func (s *TarpinBienService) collectDetailURLs(ctx context.Context) ([]string, int, error) {
	queue := []string{s.searchURL}
	visited := map[string]struct{}{}
	detailSeen := map[string]struct{}{}
	detailURLs := []string{}

	for len(queue) > 0 && len(visited) < s.maxPages {
		current := queue[0]
		queue = queue[1:]
		if _, ok := visited[current]; ok {
			continue
		}
		visited[current] = struct{}{}
		pageNumber := len(visited)

		log.Info().
			Str("source", TarpinBienSource).
			Int("page_current", pageNumber).
			Int("page_limit", s.maxPages).
			Int("pages_queued", len(queue)).
			Str("url", current).
			Msg("scraping search page started")

		body, err := s.fetch(ctx, current)
		if err != nil {
			log.Error().
				Err(err).
				Stack().
				Str("source", TarpinBienSource).
				Str("url", current).
				Str("stage", "search_page_fetch").
				Msg("failed to fetch search page")
			return detailURLs, len(visited), err
		}

		bloc := extractEventResultBlock(body)
		if bloc == "" {
			log.Warn().
				Str("source", TarpinBienSource).
				Str("url", current).
				Str("stage", "search_page_parse").
				Msg("event result block not found")
			continue
		}

		pageEventCount := 0
		for _, href := range extractAnchors(bloc, "tribe-events-read-more") {
			absolute, ok := absoluteURL(current, href)
			if !ok || !isTarpinEventURL(absolute) {
				continue
			}
			if _, exists := detailSeen[absolute]; exists {
				log.Debug().
					Str("source", TarpinBienSource).
					Str("search_page_url", current).
					Str("event_url", absolute).
					Str("reason", "already_detected").
					Msg("scraped event URL ignored during discovery")
				continue
			}
			detailSeen[absolute] = struct{}{}
			detailURLs = append(detailURLs, absolute)
			pageEventCount++
			log.Info().
				Str("source", TarpinBienSource).
				Str("search_page_url", current).
				Str("event_url", absolute).
				Int("events_found_so_far", len(detailURLs)).
				Msg("scraped event detected on search page")
		}

		paginationCount := 0
		for _, href := range extractAnchors(body, "") {
			absolute, ok := absoluteURL(current, href)
			if !ok || !isSearchPaginationURL(absolute) {
				continue
			}
			if _, exists := visited[absolute]; exists {
				continue
			}
			queue = append(queue, absolute)
			paginationCount++
		}
		log.Info().
			Str("source", TarpinBienSource).
			Str("url", current).
			Int("page_current", pageNumber).
			Int("events_detected_on_page", pageEventCount).
			Int("events_found_so_far", len(detailURLs)).
			Int("pagination_links_detected", paginationCount).
			Int("pages_queued", len(queue)).
			Msg("scraping search page completed")
	}

	sort.Strings(detailURLs)
	return detailURLs, len(visited), nil
}

func (s *TarpinBienService) scrapeDetail(ctx context.Context, detailURL string) (scrapedEvent, error) {
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Str("stage", "fetch_detail").
		Msg("scraped event detail fetch started")
	body, err := s.fetch(ctx, detailURL)
	if err != nil {
		return scrapedEvent{}, err
	}
	structured := extractSchemaEvent(body)
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Bool("schema_event_found", structured.Name != "" || structured.StartDate != "").
		Str("stage", "schema_parse").
		Msg("scraped event structured data parsed")

	titleBlock := extractFirstDivByClass(body, "titreEvent")
	title := cleanText(extractFirstTag(titleBlock, "h1"))
	if title == "" {
		title = cleanText(extractFirstTag(body, "h1"))
	}
	if title == "" {
		title = strings.TrimSpace(structured.Name)
	}
	if title == "" {
		return scrapedEvent{}, errors.New("missing title")
	}
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Str("title", title).
		Str("stage", "title_extraction").
		Msg("scraped event title extracted")

	description, descriptionBlockFound, descriptionCandidateCount := extractEventDescription(body, structured.Description)
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Int("description_length", len(description)).
		Bool("description_block_found", descriptionBlockFound).
		Int("description_candidates", descriptionCandidateCount).
		Str("stage", "description_extraction").
		Msg("scraped event description extracted")

	price := parsePrice(extractPriceText(body))
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Bool("price_found", price != nil).
		Str("stage", "price_extraction").
		Msg("scraped event price extracted")

	plage := extractFirstDivByClass(body, "plage")
	startDate, endDate, err := parseFrenchDateRange(cleanText(extractFirstElementByClass(plage, "dates")))
	if err != nil {
		startDate, endDate, err = parseSchemaDates(structured.StartDate, structured.EndDate)
		if err != nil {
			return scrapedEvent{}, err
		}
	}
	timeStart, timeEnd := parseTimeRange(extractPlageTimeText(plage))
	if timeStart == nil || timeEnd == nil {
		timeStart, timeEnd = timesFromDates(startDate, endDate)
	}
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Time("start_date", startDate).
		Time("end_date", endDate).
		Interface("time_start", timeStart).
		Interface("time_end", timeEnd).
		Str("stage", "date_extraction").
		Msg("scraped event dates extracted")

	rawAddress := cleanText(extractFirstTag(titleBlock, "address"))
	if rawAddress == "" {
		rawAddress = cleanText(structured.Location.Address)
	}
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Str("raw_address", rawAddress).
		Str("stage", "location_extraction").
		Msg("scraped event location extracted")
	normalizedAddress, err := s.normalizeAddress(ctx, rawAddress)
	if err != nil {
		log.Warn().
			Err(err).
			Str("source", TarpinBienSource).
			Str("event_url", detailURL).
			Str("address", rawAddress).
			Str("stage", "geocoding").
			Msg("address normalization failed")
		normalizedAddress = addressCandidate{Label: rawAddress}
	}
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Str("address", normalizedAddress.Label).
		Str("city", normalizedAddress.City).
		Str("postal_code", normalizedAddress.PostalCode).
		Bool("coordinates_found", normalizedAddress.Latitude != nil && normalizedAddress.Longitude != nil).
		Str("stage", "geocoding").
		Msg("scraped event address normalized")

	imageURL := ""
	if src := extractImageSrc(body, "imagePrincipale"); src != "" {
		if absolute, ok := absoluteURL(detailURL, src); ok {
			imageURL = absolute
		}
	}
	if imageURL == "" && structured.Image != "" {
		if absolute, ok := absoluteURL(detailURL, structured.Image); ok {
			imageURL = absolute
		}
	}
	if !isDisplayableImageURL(imageURL) {
		return scrapedEvent{}, errors.New("missing valid image")
	}
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", detailURL).
		Str("image_url", imageURL).
		Str("stage", "image_extraction").
		Msg("scraped event image extracted")

	return scrapedEvent{
		Title:       title,
		Description: description,
		Price:       price,
		StartDate:   startDate,
		EndDate:     endDate,
		TimeStart:   timeStart,
		TimeEnd:     timeEnd,
		Address:     firstNonEmpty(normalizedAddress.Label, rawAddress),
		City:        normalizedAddress.City,
		PostalCode:  normalizedAddress.PostalCode,
		Latitude:    normalizedAddress.Latitude,
		Longitude:   normalizedAddress.Longitude,
		ImageURL:    imageURL,
		SourceURL:   detailURL,
	}, nil
}

func (s *TarpinBienService) fetch(ctx context.Context, rawURL string) (string, error) {
	startedAt := time.Now()
	log.Debug().
		Str("source", TarpinBienSource).
		Str("method", http.MethodGet).
		Str("url", rawURL).
		Msg("scraper network request started")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", s.userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	res, err := s.httpClient.Do(req)
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("method", http.MethodGet).
			Str("url", rawURL).
			Dur("duration", time.Since(startedAt)).
			Msg("scraper network request failed")
		return "", err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		log.Warn().
			Str("source", TarpinBienSource).
			Str("method", http.MethodGet).
			Str("url", rawURL).
			Int("status_code", res.StatusCode).
			Dur("duration", time.Since(startedAt)).
			Msg("scraper network request returned non-success status")
		return "", fmt.Errorf("fetch %s: status %d", rawURL, res.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(res.Body, 5<<20))
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("method", http.MethodGet).
			Str("url", rawURL).
			Int("status_code", res.StatusCode).
			Dur("duration", time.Since(startedAt)).
			Msg("scraper network response read failed")
		return "", err
	}
	log.Info().
		Str("source", TarpinBienSource).
		Str("method", http.MethodGet).
		Str("url", rawURL).
		Int("status_code", res.StatusCode).
		Int("bytes", len(data)).
		Dur("duration", time.Since(startedAt)).
		Msg("scraper network request completed")
	return string(data), nil
}

func (s *TarpinBienService) validateRemoteImage(ctx context.Context, rawURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", s.userAgent)
	req.Header.Set("Accept", "image/*")

	res, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusMethodNotAllowed || res.StatusCode == http.StatusNotImplemented {
		return s.validateRemoteImageWithGet(ctx, rawURL)
	}
	if err := validateImageResponse(res); err != nil {
		return s.validateRemoteImageWithGet(ctx, rawURL)
	}
	return nil
}

func (s *TarpinBienService) validateRemoteImageWithGet(ctx context.Context, rawURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", s.userAgent)
	req.Header.Set("Accept", "image/*")
	req.Header.Set("Range", "bytes=0-0")

	res, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	return validateImageResponse(res)
}

func validateImageResponse(res *http.Response) error {
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("status %d", res.StatusCode)
	}

	contentType := strings.ToLower(strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0]))
	if !strings.HasPrefix(contentType, "image/") || contentType == "image/svg+xml" {
		return fmt.Errorf("content type %q", contentType)
	}

	return nil
}

func (s *TarpinBienService) loadCategories(ctx context.Context) ([]eventCategory, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, slug
		FROM event_categories
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("load event categories: %w", err)
	}
	defer rows.Close()

	var categories []eventCategory
	for rows.Next() {
		var category eventCategory
		if err := rows.Scan(&category.ID, &category.Name, &category.Slug); err != nil {
			return nil, fmt.Errorf("scan event category: %w", err)
		}
		categories = append(categories, category)
	}
	return categories, rows.Err()
}

func (s *TarpinBienService) saveScrapedEvent(ctx context.Context, event scrapedEvent) (eventPersistenceResult, error) {
	event.EndDate = normalizeEndDate(event.StartDate, event.EndDate)

	existing, exists, err := s.findExistingScrapedEvent(ctx, event)
	if err != nil {
		return eventPersistenceResult{}, fmt.Errorf("check scraped event duplicate: %w", err)
	}
	log.Debug().
		Str("source", TarpinBienSource).
		Str("event_url", event.SourceURL).
		Str("title", event.Title).
		Bool("exists", exists).
		Str("stage", "duplicate_lookup").
		Msg("scraped event duplicate lookup completed")

	imageResult, err := s.resolveScrapedEventImage(ctx, event, existing, exists)
	if err != nil {
		return eventPersistenceResult{}, err
	}
	event.ImageOptimizedURL = imageResult.URLs.OptimizedURL
	event.ImageThumbnailURL = imageResult.URLs.ThumbnailURL

	if exists {
		return s.updateScrapedEventIfChanged(ctx, existing, event, imageResult)
	}
	return s.insertScrapedEvent(ctx, event, imageResult)
}

func (s *TarpinBienService) findExistingScrapedEvent(ctx context.Context, event scrapedEvent) (existingScrapedEvent, bool, error) {
	var existing existingScrapedEvent
	err := s.db.QueryRowContext(ctx, `
		SELECT
			id,
			title,
			description,
			start_date,
			end_date,
			time_start,
			time_end,
			latitude,
			longitude,
			address,
			city,
			postal_code,
			image,
			external_image_url,
			image_optimized_url,
			image_thumbnail_url,
			price
		FROM events
		WHERE deleted_at IS NULL
		  AND (
		      (source_url IS NOT NULL AND source_url = $1)
		      OR (source = $2 AND LOWER(title) = LOWER($3) AND DATE(start_date) = DATE($4::timestamp))
		  )
		ORDER BY
			CASE
				WHEN source_url = $1 THEN 0
				WHEN address = $5 THEN 1
				ELSE 2
			END,
			updated_at DESC
		LIMIT 1
	`, event.SourceURL, TarpinBienSource, event.Title, formatEventDateTimeForDB(event.StartDate), event.Address).Scan(
		&existing.ID,
		&existing.Title,
		&existing.Description,
		&existing.StartDate,
		&existing.EndDate,
		&existing.TimeStart,
		&existing.TimeEnd,
		&existing.Latitude,
		&existing.Longitude,
		&existing.Address,
		&existing.City,
		&existing.PostalCode,
		&existing.Image,
		&existing.ExternalImageURL,
		&existing.ImageOptimizedURL,
		&existing.ImageThumbnailURL,
		&existing.Price,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return existingScrapedEvent{}, false, nil
		}
		return existingScrapedEvent{}, false, err
	}
	return existing, true, nil
}

func (s *TarpinBienService) resolveScrapedEventImage(ctx context.Context, event scrapedEvent, existing existingScrapedEvent, exists bool) (scrapedImageResult, error) {
	if exists &&
		strings.TrimSpace(existing.ExternalImageURL.String) == strings.TrimSpace(event.ImageURL) &&
		existing.ImageOptimizedURL.Valid &&
		existing.ImageThumbnailURL.Valid &&
		strings.TrimSpace(existing.ImageOptimizedURL.String) != "" &&
		strings.TrimSpace(existing.ImageThumbnailURL.String) != "" {
		log.Info().
			Str("source", TarpinBienSource).
			Str("event_url", event.SourceURL).
			Str("image_url", event.ImageURL).
			Int64("event_id", existing.ID).
			Str("stage", "image_processing").
			Str("reason", "existing_optimized_image_reused").
			Msg("scraped event image processing skipped")
		return scrapedImageResult{
			URLs: scrapedImageURLs{
				OriginalURL:  event.ImageURL,
				OptimizedURL: existing.ImageOptimizedURL.String,
				ThumbnailURL: existing.ImageThumbnailURL.String,
			},
			CacheHit: true,
		}, nil
	}

	imageResult, err := s.optimizeScrapedImage(ctx, event.ImageURL)
	if err != nil {
		return scrapedImageResult{}, fmt.Errorf("optimize scraped event image: %w", err)
	}
	return imageResult, nil
}

func (s *TarpinBienService) insertScrapedEvent(ctx context.Context, event scrapedEvent, imageResult scrapedImageResult) (eventPersistenceResult, error) {
	log.Info().
		Str("source", TarpinBienSource).
		Str("event_url", event.SourceURL).
		Str("title", event.Title).
		Str("stage", "database_insert").
		Msg("scraped event insert started")

	var price sql.NullFloat64
	if event.Price != nil {
		price = sql.NullFloat64{Float64: float64(*event.Price), Valid: true}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return eventPersistenceResult{}, fmt.Errorf("begin scraper insert tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var eventID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO events (
			organization_id,
			title,
			description,
			start_date,
			end_date,
			time_start,
			time_end,
			latitude,
			longitude,
			address,
			city,
			postal_code,
			image,
			external_image_url,
			image_optimized_url,
			image_thumbnail_url,
			price,
			ticketing_link,
			source,
			source_url,
			is_active
		)
		VALUES (
			NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9,
			$10, $11, $12, $13, $14, $15, $16, NULL, $17, $18, TRUE
		)
		RETURNING id
	`,
		event.Title,
		event.Description,
		formatEventDateTimeForDB(event.StartDate),
		formatEventDateTimeForDB(event.EndDate),
		nullStringValue(event.TimeStart),
		nullStringValue(event.TimeEnd),
		nullFloatValue(event.Latitude),
		nullFloatValue(event.Longitude),
		event.Address,
		event.City,
		event.PostalCode,
		firstNonEmpty(event.ImageOptimizedURL, event.ImageURL),
		event.ImageURL,
		nullStringFromString(event.ImageOptimizedURL),
		nullStringFromString(event.ImageThumbnailURL),
		price,
		TarpinBienSource,
		event.SourceURL,
	).Scan(&eventID)
	if err != nil {
		if strings.Contains(err.Error(), "idx_events_source_url_unique") {
			return eventPersistenceResult{Outcome: eventUnchanged, UnchangedReason: "source_url_unique_conflict"}, nil
		}
		return eventPersistenceResult{}, fmt.Errorf("insert scraped event: %w", err)
	}

	for _, categoryID := range event.CategoryIDs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO event_categories_links (event_id, event_category_id)
			VALUES ($1, $2)
			ON CONFLICT (event_id, event_category_id) DO NOTHING
		`, eventID, categoryID); err != nil {
			return eventPersistenceResult{}, fmt.Errorf("link scraped event category: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return eventPersistenceResult{}, fmt.Errorf("commit scraper insert tx: %w", err)
	}
	log.Info().
		Str("source", TarpinBienSource).
		Str("event_url", event.SourceURL).
		Int64("event_id", eventID).
		Str("stage", "database_insert").
		Msg("scraped event inserted")
	return eventPersistenceResult{
		Outcome:         eventCreated,
		EventID:         eventID,
		ImageDownloaded: imageResult.Downloaded,
		ImageCacheHit:   imageResult.CacheHit,
		ChangedFields:   []string{"created"},
	}, nil
}

func (s *TarpinBienService) updateScrapedEventIfChanged(ctx context.Context, existing existingScrapedEvent, event scrapedEvent, imageResult scrapedImageResult) (eventPersistenceResult, error) {
	changedFields := changedScrapedEventFields(existing, event)
	existingCategoryIDs, err := s.loadEventCategoryIDs(ctx, existing.ID)
	if err != nil {
		return eventPersistenceResult{}, fmt.Errorf("load scraped event categories: %w", err)
	}
	categoriesChanged := !int64SlicesEqual(existingCategoryIDs, event.CategoryIDs)
	if categoriesChanged {
		changedFields = append(changedFields, "categories")
	}

	if len(changedFields) == 0 {
		log.Info().
			Str("source", TarpinBienSource).
			Str("event_url", event.SourceURL).
			Int64("event_id", existing.ID).
			Str("stage", "database_update").
			Str("reason", "data_unchanged").
			Msg("scraped event unchanged")
		return eventPersistenceResult{
			Outcome:         eventUnchanged,
			EventID:         existing.ID,
			ImageDownloaded: imageResult.Downloaded,
			ImageCacheHit:   imageResult.CacheHit,
			UnchangedReason: "data_unchanged",
		}, nil
	}

	log.Info().
		Str("source", TarpinBienSource).
		Str("event_url", event.SourceURL).
		Str("title", event.Title).
		Int64("event_id", existing.ID).
		Strs("changed_fields", changedFields).
		Str("stage", "database_update").
		Msg("scraped event update started")

	var price sql.NullFloat64
	if event.Price != nil {
		price = sql.NullFloat64{Float64: float64(*event.Price), Valid: true}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return eventPersistenceResult{}, fmt.Errorf("begin scraper update tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if len(changedFields) > 0 {
		if _, err := tx.ExecContext(ctx, `
			UPDATE events
			SET title = $1,
				description = $2,
				start_date = $3,
				end_date = $4,
				time_start = $5,
				time_end = $6,
				latitude = $7,
				longitude = $8,
				address = $9,
				city = $10,
				postal_code = $11,
				image = $12,
				external_image_url = $13,
				image_optimized_url = $14,
				image_thumbnail_url = $15,
				price = $16,
				source = $17,
				source_url = $18,
				is_active = TRUE,
				updated_at = NOW()
			WHERE id = $19
		`,
			event.Title,
			event.Description,
			formatEventDateTimeForDB(event.StartDate),
			formatEventDateTimeForDB(event.EndDate),
			nullStringValue(event.TimeStart),
			nullStringValue(event.TimeEnd),
			nullFloatValue(event.Latitude),
			nullFloatValue(event.Longitude),
			event.Address,
			event.City,
			event.PostalCode,
			firstNonEmpty(event.ImageOptimizedURL, event.ImageURL),
			event.ImageURL,
			nullStringFromString(event.ImageOptimizedURL),
			nullStringFromString(event.ImageThumbnailURL),
			price,
			TarpinBienSource,
			event.SourceURL,
			existing.ID,
		); err != nil {
			return eventPersistenceResult{}, fmt.Errorf("update scraped event: %w", err)
		}
	}

	if categoriesChanged {
		if err := replaceEventCategories(ctx, tx, existing.ID, event.CategoryIDs); err != nil {
			return eventPersistenceResult{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return eventPersistenceResult{}, fmt.Errorf("commit scraper update tx: %w", err)
	}
	log.Info().
		Str("source", TarpinBienSource).
		Str("event_url", event.SourceURL).
		Int64("event_id", existing.ID).
		Strs("changed_fields", changedFields).
		Str("stage", "database_update").
		Msg("scraped event updated")
	return eventPersistenceResult{
		Outcome:         eventUpdated,
		EventID:         existing.ID,
		ImageDownloaded: imageResult.Downloaded,
		ImageCacheHit:   imageResult.CacheHit,
		ChangedFields:   changedFields,
	}, nil
}

func (s *TarpinBienService) loadEventCategoryIDs(ctx context.Context, eventID int64) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT event_category_id
		FROM event_categories_links
		WHERE event_id = $1
		ORDER BY event_category_id ASC
	`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

type eventCategoryReplacer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func replaceEventCategories(ctx context.Context, tx eventCategoryReplacer, eventID int64, categoryIDs []int64) error {
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM event_categories_links
		WHERE event_id = $1
	`, eventID); err != nil {
		return fmt.Errorf("delete scraped event categories: %w", err)
	}
	for _, categoryID := range categoryIDs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO event_categories_links (event_id, event_category_id)
			VALUES ($1, $2)
			ON CONFLICT (event_id, event_category_id) DO NOTHING
		`, eventID, categoryID); err != nil {
			return fmt.Errorf("link scraped event category: %w", err)
		}
	}
	return nil
}

func changedScrapedEventFields(existing existingScrapedEvent, event scrapedEvent) []string {
	changed := make([]string, 0)
	if existing.Title != event.Title {
		changed = append(changed, "title")
	}
	if existing.Description != event.Description {
		changed = append(changed, "description")
	}
	if !sameLocalDateTime(existing.StartDate, event.StartDate) {
		changed = append(changed, "start_date")
	}
	if !sameLocalDateTime(existing.EndDate, event.EndDate) {
		changed = append(changed, "end_date")
	}
	if !sameNullableString(existing.TimeStart, nullStringValue(event.TimeStart)) {
		changed = append(changed, "time_start")
	}
	if !sameNullableString(existing.TimeEnd, nullStringValue(event.TimeEnd)) {
		changed = append(changed, "time_end")
	}
	if !sameNullableFloat(existing.Latitude, nullFloatValue(event.Latitude)) {
		changed = append(changed, "latitude")
	}
	if !sameNullableFloat(existing.Longitude, nullFloatValue(event.Longitude)) {
		changed = append(changed, "longitude")
	}
	if existing.Address != event.Address {
		changed = append(changed, "address")
	}
	if existing.City != event.City {
		changed = append(changed, "city")
	}
	if existing.PostalCode != event.PostalCode {
		changed = append(changed, "postal_code")
	}
	if existing.Image != firstNonEmpty(event.ImageOptimizedURL, event.ImageURL) {
		changed = append(changed, "image")
	}
	if !sameNullableString(existing.ExternalImageURL, nullStringFromString(event.ImageURL)) {
		changed = append(changed, "external_image_url")
	}
	if !sameNullableString(existing.ImageOptimizedURL, nullStringFromString(event.ImageOptimizedURL)) {
		changed = append(changed, "image_optimized_url")
	}
	if !sameNullableString(existing.ImageThumbnailURL, nullStringFromString(event.ImageThumbnailURL)) {
		changed = append(changed, "image_thumbnail_url")
	}
	var price sql.NullFloat64
	if event.Price != nil {
		price = sql.NullFloat64{Float64: float64(*event.Price), Valid: true}
	}
	if !sameNullableFloat(existing.Price, price) {
		changed = append(changed, "price")
	}
	return changed
}

func sameLocalDateTime(left time.Time, right time.Time) bool {
	return formatEventDateTimeForDB(left) == formatEventDateTimeForDB(right)
}

func sameNullableString(left sql.NullString, right sql.NullString) bool {
	if left.Valid != right.Valid {
		return false
	}
	if !left.Valid {
		return true
	}
	return strings.TrimSpace(left.String) == strings.TrimSpace(right.String)
}

func sameNullableFloat(left sql.NullFloat64, right sql.NullFloat64) bool {
	if left.Valid != right.Valid {
		return false
	}
	if !left.Valid {
		return true
	}
	return math.Abs(left.Float64-right.Float64) < 0.000001
}

func int64SlicesEqual(left []int64, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	leftCopy := append([]int64(nil), left...)
	rightCopy := append([]int64(nil), right...)
	sort.Slice(leftCopy, func(i, j int) bool { return leftCopy[i] < leftCopy[j] })
	sort.Slice(rightCopy, func(i, j int) bool { return rightCopy[i] < rightCopy[j] })
	for index := range leftCopy {
		if leftCopy[index] != rightCopy[index] {
			return false
		}
	}
	return true
}

type addressCandidate struct {
	Label      string
	City       string
	PostalCode string
	Latitude   *float64
	Longitude  *float64
}

func (s *TarpinBienService) normalizeAddress(ctx context.Context, rawAddress string) (addressCandidate, error) {
	rawAddress = strings.TrimSpace(rawAddress)
	if rawAddress == "" {
		log.Warn().
			Str("source", TarpinBienSource).
			Str("stage", "geocoding").
			Str("reason", "empty_address").
			Msg("address normalization skipped")
		return addressCandidate{}, nil
	}

	endpoint, err := url.Parse(addressAPIURL)
	if err != nil {
		return addressCandidate{}, err
	}
	query := endpoint.Query()
	query.Set("q", rawAddress)
	query.Set("limit", "1")
	query.Set("index", "address")
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return addressCandidate{}, err
	}
	req.Header.Set("User-Agent", s.userAgent)
	req.Header.Set("Accept", "application/json")

	startedAt := time.Now()
	log.Debug().
		Str("source", TarpinBienSource).
		Str("method", http.MethodGet).
		Str("url", endpoint.String()).
		Str("address", rawAddress).
		Str("stage", "geocoding").
		Msg("scraper geocoding request started")
	res, err := s.httpClient.Do(req)
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("method", http.MethodGet).
			Str("url", endpoint.String()).
			Str("address", rawAddress).
			Str("stage", "geocoding").
			Dur("duration", time.Since(startedAt)).
			Msg("scraper geocoding request failed")
		return addressCandidate{}, err
	}
	defer res.Body.Close()
	log.Info().
		Str("source", TarpinBienSource).
		Str("method", http.MethodGet).
		Str("url", endpoint.String()).
		Str("address", rawAddress).
		Int("status_code", res.StatusCode).
		Str("stage", "geocoding").
		Dur("duration", time.Since(startedAt)).
		Msg("scraper geocoding response received")
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return addressCandidate{}, fmt.Errorf("geocoding service status %d", res.StatusCode)
	}

	var payload struct {
		Features []struct {
			Geometry struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties struct {
				Label    string `json:"label"`
				Postcode string `json:"postcode"`
				City     string `json:"city"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&payload); err != nil {
		return addressCandidate{}, err
	}
	if len(payload.Features) == 0 {
		log.Warn().
			Str("source", TarpinBienSource).
			Str("address", rawAddress).
			Str("stage", "geocoding").
			Str("reason", "no_candidate").
			Msg("scraper geocoding produced no candidate")
		return addressCandidate{Label: rawAddress}, nil
	}

	feature := payload.Features[0]
	candidate := addressCandidate{
		Label:      firstNonEmpty(feature.Properties.Label, rawAddress),
		City:       feature.Properties.City,
		PostalCode: feature.Properties.Postcode,
	}
	if len(feature.Geometry.Coordinates) >= 2 {
		longitude := feature.Geometry.Coordinates[0]
		latitude := feature.Geometry.Coordinates[1]
		candidate.Longitude = &longitude
		candidate.Latitude = &latitude
	}
	return candidate, nil
}

func nullStringValue(value *string) sql.NullString {
	if value == nil || strings.TrimSpace(*value) == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: strings.TrimSpace(*value), Valid: true}
}

func nullStringFromString(value string) sql.NullString {
	value = strings.TrimSpace(value)
	if value == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: value, Valid: true}
}

func nullFloatValue(value *float64) sql.NullFloat64 {
	if value == nil {
		return sql.NullFloat64{}
	}
	return sql.NullFloat64{Float64: *value, Valid: true}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func isTarpinEventURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Hostname(), "tarpin-bien.com") && strings.Contains(parsed.Path, "/evenement/")
}

func isSearchPaginationURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if !strings.EqualFold(parsed.Hostname(), "tarpin-bien.com") {
		return false
	}
	if strings.Contains(parsed.Path, "/evenement/") {
		return false
	}
	return strings.Contains(parsed.Path, "/recherche/") && (parsed.Query().Get("evenementCheck") == "1" || strings.Contains(parsed.RawQuery, "evenementCheck=1"))
}

func absoluteURL(baseURL string, href string) (string, bool) {
	href = strings.TrimSpace(html.UnescapeString(href))
	if href == "" || strings.HasPrefix(strings.ToLower(href), "javascript:") || strings.HasPrefix(href, "#") {
		return "", false
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return "", false
	}
	parsed, err := url.Parse(href)
	if err != nil {
		return "", false
	}
	return base.ResolveReference(parsed).String(), true
}

func isDisplayableImageURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}
	if parsed.Host == "" {
		return false
	}

	return !strings.HasSuffix(strings.ToLower(parsed.Path), ".svg")
}

func extractEventResultBlock(markup string) string {
	bloc := extractDivByID(markup, "evenement")
	if bloc != "" {
		return bloc
	}

	markerRE := regexp.MustCompile(`(?is)<div\b[^>]*class\s*=\s*["'][^"']*\bblocResult\b[^"']*["'][^>]*id\s*=\s*["']evenement["'][^>]*>`)
	loc := markerRE.FindStringIndex(markup)
	if loc == nil {
		markerRE = regexp.MustCompile(`(?is)<div\b[^>]*id\s*=\s*["']evenement["'][^>]*class\s*=\s*["'][^"']*\bblocResult\b[^"']*["'][^>]*>`)
		loc = markerRE.FindStringIndex(markup)
	}
	if loc == nil {
		return ""
	}

	nextRE := regexp.MustCompile(`(?is)<div\b[^>]*class\s*=\s*["'][^"']*\bblocResult\b[^"']*["'][^>]*id\s*=\s*["'](lieu|activite|article|guide|shopping|restaurant|bar)["']`)
	rest := markup[loc[1]:]
	if next := nextRE.FindStringIndex(rest); next != nil {
		return markup[loc[0] : loc[1]+next[0]]
	}
	return markup[loc[0]:]
}

func bestCategoryIDs(categories []eventCategory, text string) []int64 {
	normalized := normalizeForMatch(text)
	bestScore := 0
	scores := map[int64]int{}
	for _, category := range categories {
		score := categoryScore(category.Slug, normalized)
		if score <= 0 {
			continue
		}
		scores[category.ID] = score
		if score > bestScore {
			bestScore = score
		}
	}
	if bestScore == 0 {
		return nil
	}

	ids := make([]int64, 0)
	for id, score := range scores {
		if score == bestScore {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func categoryScore(slug string, text string) int {
	score := 0
	for _, keyword := range categoryKeywords[strings.ToLower(slug)] {
		keyword = normalizeForMatch(keyword)
		if keyword != "" && strings.Contains(text, keyword) {
			score++
		}
	}
	return score
}

var categoryKeywords = map[string][]string{
	"animaux":     {"animal", "animaux", "chien", "chat"},
	"art":         {"art", "oeuvre", "artiste", "galerie", "peinture", "sculpture"},
	"associatif":  {"association", "associatif", "benevole"},
	"atelier":     {"atelier", "workshop", "initiation", "creation"},
	"automobile":  {"automobile", "voiture", "moto", "vehicule"},
	"bien-etre":   {"bien-etre", "yoga", "meditation", "massage", "relaxation"},
	"business":    {"business", "entrepreneur", "startup", "commerce"},
	"cinema":      {"cinema", "film", "projection"},
	"concert":     {"concert", "live", "musique", "groupe", "dj"},
	"conference":  {"conference", "rencontre", "debat", "table ronde"},
	"culture":     {"culture", "culturel", "patrimoine", "histoire"},
	"emploi":      {"emploi", "job", "recrutement", "carriere"},
	"enfants":     {"enfant", "kids", "jeunesse"},
	"esport":      {"esport", "e-sport", "tournoi"},
	"famille":     {"famille", "familial"},
	"festival":    {"festival", "fest", "edition"},
	"food":        {"food", "street food", "cuisine"},
	"formation":   {"formation", "cours", "apprendre"},
	"gaming":      {"gaming", "jeu video", "console"},
	"gastronomie": {"gastronomie", "degustation", "restaurant", "chef"},
	"humour":      {"humour", "stand-up", "comedie"},
	"jeux":        {"jeu", "jeux", "ludique"},
	"marche":      {"marche", "marche local", "brocante"},
	"mode":        {"mode", "fashion", "vetement"},
	"musique":     {"musique", "musical", "concert", "dj"},
	"nature":      {"nature", "ecologie", "jardin"},
	"networking":  {"networking", "reseautage", "afterwork"},
	"nightlife":   {"nightlife", "club", "boite", "nuit"},
	"patrimoine":  {"patrimoine", "monument", "musee", "histoire"},
	"plein-air":   {"plein air", "outdoor", "exterieur"},
	"randonnee":   {"randonnee", "balade", "marche"},
	"sante":       {"sante", "medical", "prevention"},
	"shopping":    {"shopping", "boutique", "vente"},
	"solidarite":  {"solidarite", "caritatif", "don"},
	"soiree":      {"soiree", "afterwork", "apero"},
	"spectacle":   {"spectacle", "scene", "show"},
	"sport":       {"sport", "course", "football", "randonnee", "velo"},
	"technologie": {"technologie", "tech", "numerique", "ia"},
	"theatre":     {"theatre", "piece", "comedien"},
	"tourisme":    {"tourisme", "visite", "decouverte"},
	"etudiant":    {"etudiant", "campus", "universite"},
	"exposition":  {"exposition", "musee", "galerie", "art", "oeuvre"},
}

func normalizeForMatch(value string) string {
	value = strings.ToLower(value)
	replacer := strings.NewReplacer(
		"à", "a", "â", "a", "ä", "a",
		"ç", "c",
		"é", "e", "è", "e", "ê", "e", "ë", "e",
		"î", "i", "ï", "i",
		"ô", "o", "ö", "o",
		"ù", "u", "û", "u", "ü", "u",
		"œ", "oe",
	)
	value = replacer.Replace(value)
	return strings.Join(strings.Fields(value), " ")
}

var (
	openDivRE             = regexp.MustCompile(`(?is)<div\b[^>]*>`)
	openElementRE         = regexp.MustCompile(`(?is)<([a-z][a-z0-9]*)\b[^>]*>`)
	divTagRE              = regexp.MustCompile(`(?is)<(/?)div\b[^>]*>`)
	attrRE                = regexp.MustCompile(`(?is)\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`)
	tagStripRE            = regexp.MustCompile(`(?is)<script\b.*?</script>|<style\b.*?</style>|<[^>]+>`)
	scriptStyleRE         = regexp.MustCompile(`(?is)<script\b.*?</script>|<style\b.*?</style>`)
	lineBreakTagRE        = regexp.MustCompile(`(?is)<br\b[^>]*>`)
	listItemOpenTagRE     = regexp.MustCompile(`(?is)<li\b[^>]*>`)
	blockCloseTagRE       = regexp.MustCompile(`(?is)</\s*(p|div|li|ul|ol|h[1-6]|blockquote|section|article|tr)\s*>`)
	blockOpenTagRE        = regexp.MustCompile(`(?is)<(p|div|ul|ol|h[1-6]|blockquote|section|article|tr)\b[^>]*>`)
	remainingTagRE        = regexp.MustCompile(`(?is)<[^>]+>`)
	horizontalSpacesRE    = regexp.MustCompile(`[ \t\f\v]+`)
	newlineAroundSpacesRE = regexp.MustCompile(`[ \t\f\v]*\n[ \t\f\v]*`)
	multipleNewlinesRE    = regexp.MustCompile(`\n{3,}`)
	spaceBeforePunctRE    = regexp.MustCompile(`\s+([,.])`)
)

var descriptionCandidateClasses = []string{
	"tribe-events-single-event-description",
	"tribe-events-content",
	"entry-content",
	"description",
}

type schemaEvent struct {
	Name        string `json:"name"`
	Image       string `json:"image"`
	StartDate   string `json:"startDate"`
	EndDate     string `json:"endDate"`
	Description string `json:"description"`
	Location    struct {
		Address string `json:"address"`
	} `json:"location"`
}

func extractSchemaEvent(markup string) schemaEvent {
	re := regexp.MustCompile(`(?is)<script\b[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>`)
	for _, match := range re.FindAllStringSubmatch(markup, -1) {
		raw := strings.TrimSpace(match[1])
		if raw == "" {
			continue
		}

		var events []schemaEvent
		if err := json.Unmarshal([]byte(raw), &events); err == nil {
			for _, event := range events {
				if event.Name != "" || event.StartDate != "" {
					return event
				}
			}
		}

		var event schemaEvent
		if err := json.Unmarshal([]byte(raw), &event); err == nil && (event.Name != "" || event.StartDate != "") {
			return event
		}
	}
	return schemaEvent{}
}

func extractDivByID(markup string, id string) string {
	for _, loc := range openDivRE.FindAllStringIndex(markup, -1) {
		tag := markup[loc[0]:loc[1]]
		if strings.EqualFold(attrValue(tag, "id"), id) {
			return extractBalancedDiv(markup, loc[0])
		}
	}
	return ""
}

func extractFirstDivByClass(markup string, className string) string {
	divs := extractDivsByClass(markup, className)
	if len(divs) == 0 {
		return ""
	}
	return divs[0]
}

func extractDivsByClass(markup string, className string) []string {
	var out []string
	for _, loc := range openDivRE.FindAllStringIndex(markup, -1) {
		tag := markup[loc[0]:loc[1]]
		if hasClass(tag, className) {
			if div := extractBalancedDiv(markup, loc[0]); div != "" {
				out = append(out, div)
			}
		}
	}
	return out
}

func extractElementsByClass(markup string, className string) []string {
	var out []string
	for _, match := range openElementRE.FindAllStringSubmatchIndex(markup, -1) {
		if len(match) < 4 || match[2] < 0 || match[3] < 0 {
			continue
		}
		tagName := strings.ToLower(markup[match[2]:match[3]])
		openTag := markup[match[0]:match[1]]
		if !hasClass(openTag, className) {
			continue
		}
		if element := extractBalancedElement(markup, match[0], tagName); element != "" {
			out = append(out, element)
		}
	}
	return out
}

func extractBalancedDiv(markup string, start int) string {
	matches := divTagRE.FindAllStringSubmatchIndex(markup[start:], -1)
	depth := 0
	for _, match := range matches {
		if match[2] >= 0 {
			depth--
		} else {
			depth++
		}
		if depth == 0 {
			return markup[start : start+match[1]]
		}
	}
	return ""
}

func extractBalancedElement(markup string, start int, tagName string) string {
	if tagName == "" || isVoidElement(tagName) {
		loc := openElementRE.FindStringIndex(markup[start:])
		if loc == nil {
			return ""
		}
		return markup[start : start+loc[1]]
	}

	tagRE := regexp.MustCompile(`(?is)</?` + regexp.QuoteMeta(tagName) + `\b[^>]*>`)
	matches := tagRE.FindAllStringIndex(markup[start:], -1)
	depth := 0
	for _, match := range matches {
		tag := markup[start+match[0] : start+match[1]]
		if strings.HasPrefix(strings.TrimSpace(tag), "</") {
			depth--
		} else if !strings.HasSuffix(strings.TrimSpace(tag), "/>") {
			depth++
		}
		if depth == 0 {
			return markup[start : start+match[1]]
		}
	}
	return ""
}

func isVoidElement(tagName string) bool {
	switch strings.ToLower(tagName) {
	case "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr":
		return true
	default:
		return false
	}
}

func extractAnchors(markup string, requiredClass string) []string {
	re := regexp.MustCompile(`(?is)<a\b[^>]*>`)
	var hrefs []string
	for _, tag := range re.FindAllString(markup, -1) {
		if requiredClass != "" && !hasClass(tag, requiredClass) {
			continue
		}
		if href := attrValue(tag, "href"); href != "" {
			hrefs = append(hrefs, href)
		}
	}
	return hrefs
}

func extractImageSrc(markup string, requiredClass string) string {
	re := regexp.MustCompile(`(?is)<img\b[^>]*>`)
	for _, tag := range re.FindAllString(markup, -1) {
		if requiredClass != "" && !hasClass(tag, requiredClass) {
			continue
		}
		for _, attrName := range []string{"data-src", "data-lazy-src", "data-original", "src"} {
			if src := cleanImageSrcCandidate(attrValue(tag, attrName)); src != "" {
				return src
			}
		}
		for _, attrName := range []string{"data-srcset", "srcset"} {
			if src := bestSrcsetCandidate(attrValue(tag, attrName)); src != "" {
				return src
			}
		}
	}
	return ""
}

func cleanImageSrcCandidate(src string) string {
	src = strings.TrimSpace(html.UnescapeString(src))
	if src == "" {
		return ""
	}

	normalized := strings.ToLower(src)
	if strings.HasPrefix(normalized, "data:") || strings.HasPrefix(normalized, "javascript:") || strings.HasPrefix(src, "#") {
		return ""
	}
	return src
}

func bestSrcsetCandidate(srcset string) string {
	candidates := strings.Split(srcset, ",")
	for index := len(candidates) - 1; index >= 0; index-- {
		fields := strings.Fields(candidates[index])
		if len(fields) == 0 {
			continue
		}
		if src := cleanImageSrcCandidate(fields[0]); src != "" {
			return src
		}
	}
	return ""
}

func attrValue(tag string, name string) string {
	for _, match := range attrRE.FindAllStringSubmatch(tag, -1) {
		if strings.EqualFold(match[1], name) {
			for i := 3; i <= 5; i++ {
				if match[i] != "" {
					return html.UnescapeString(match[i])
				}
			}
		}
	}
	return ""
}

func hasClass(tag string, className string) bool {
	classes := strings.Fields(attrValue(tag, "class"))
	for _, class := range classes {
		if class == className {
			return true
		}
	}
	return false
}

func extractFirstTag(markup string, tag string) string {
	re := regexp.MustCompile(`(?is)<` + regexp.QuoteMeta(tag) + `\b[^>]*>(.*?)</` + regexp.QuoteMeta(tag) + `>`)
	match := re.FindStringSubmatch(markup)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func extractFirstElementByClass(markup string, className string) string {
	re := regexp.MustCompile(`(?is)<[a-z0-9]+\b[^>]*class\s*=\s*["'][^"']*\b` + regexp.QuoteMeta(className) + `\b[^"']*["'][^>]*>(.*?)</[a-z0-9]+>`)
	match := re.FindStringSubmatch(markup)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func extractEventDescription(markup string, schemaDescription string) (string, bool, int) {
	best := ""
	candidateCount := 0
	seen := map[string]struct{}{}

	for _, className := range descriptionCandidateClasses {
		for _, block := range extractElementsByClass(markup, className) {
			description := descriptionFromMarkup(block)
			if description == "" {
				continue
			}
			if _, exists := seen[description]; exists {
				continue
			}
			seen[description] = struct{}{}
			candidateCount++
			if len(description) > len(best) {
				best = description
			}
		}
	}

	if best != "" {
		return best, true, candidateCount
	}
	return cleanText(schemaDescription), false, candidateCount
}

func descriptionFromMarkup(markup string) string {
	return cleanTextPreservingBlocks(markup)
}

func cleanText(value string) string {
	value = tagStripRE.ReplaceAllString(value, " ")
	value = html.UnescapeString(value)
	return strings.Join(strings.Fields(value), " ")
}

func cleanTextPreservingBlocks(value string) string {
	value = scriptStyleRE.ReplaceAllString(value, " ")
	value = lineBreakTagRE.ReplaceAllString(value, "\n")
	value = listItemOpenTagRE.ReplaceAllString(value, "\n- ")
	value = blockCloseTagRE.ReplaceAllString(value, "\n")
	value = blockOpenTagRE.ReplaceAllString(value, "\n")
	value = remainingTagRE.ReplaceAllString(value, " ")
	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.ReplaceAll(value, "\u00a0", " ")
	value = horizontalSpacesRE.ReplaceAllString(value, " ")
	value = spaceBeforePunctRE.ReplaceAllString(value, "$1")
	value = newlineAroundSpacesRE.ReplaceAllString(value, "\n")
	value = multipleNewlinesRE.ReplaceAllString(value, "\n\n")
	return strings.TrimSpace(value)
}

func extractPriceText(markup string) string {
	tableRE := regexp.MustCompile(`(?is)<table\b[^>]*class\s*=\s*["'][^"']*\btarifs\b[^"']*["'][^>]*>.*?</table>`)
	table := tableRE.FindString(markup)
	if table == "" {
		return ""
	}
	cellRE := regexp.MustCompile(`(?is)<td\b[^>]*class\s*=\s*["'][^"']*\bnombretarif\b[^"']*["'][^>]*>(.*?)</td>`)
	match := cellRE.FindStringSubmatch(table)
	if len(match) < 2 {
		return ""
	}
	return cleanText(match[1])
}

func parsePrice(value string) *int {
	normalized := normalizeForMatch(value)
	if normalized == "" {
		return nil
	}
	if strings.Contains(normalized, "gratuit") || strings.Contains(normalized, "libre") {
		price := 0
		return &price
	}
	re := regexp.MustCompile(`\d+(?:[,.]\d+)?`)
	raw := re.FindString(normalized)
	if raw == "" {
		return nil
	}
	raw = strings.ReplaceAll(raw, ",", ".")
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil
	}
	price := int(math.Round(parsed))
	return &price
}

func extractPlageTimeText(markup string) string {
	re := regexp.MustCompile(`(?is)<li\b[^>]*>.*?<strong\b[^>]*>(.*?)</strong>.*?</li>`)
	for _, match := range re.FindAllStringSubmatch(markup, -1) {
		text := cleanText(match[1])
		if strings.Contains(strings.ToLower(text), "h") {
			return text
		}
	}
	return ""
}

func parseTimeRange(value string) (*string, *string) {
	value = strings.ToLower(strings.TrimSpace(value))
	re := regexp.MustCompile(`(\d{1,2})\s*h\s*(\d{0,2})\s*(?:a|à|-)\s*(\d{1,2})\s*h\s*(\d{0,2})`)
	match := re.FindStringSubmatch(value)
	if len(match) < 5 {
		return nil, nil
	}
	start := formatClock(match[1], match[2])
	end := formatClock(match[3], match[4])
	return &start, &end
}

func formatClock(hourRaw, minuteRaw string) string {
	hour, _ := strconv.Atoi(hourRaw)
	minute := 0
	if minuteRaw != "" {
		minute, _ = strconv.Atoi(minuteRaw)
	}
	return fmt.Sprintf("%02d:%02d:00", hour, minute)
}

func parseFrenchDateRange(value string) (time.Time, time.Time, error) {
	value = normalizeForMatch(value)
	dateRE := regexp.MustCompile(`(\d{1,2})\s+([a-z]+)\s+(\d{4})`)
	matches := dateRE.FindAllStringSubmatch(value, -1)
	if len(matches) == 0 {
		return time.Time{}, time.Time{}, fmt.Errorf("missing date range: %q", value)
	}
	start, err := parseFrenchDateParts(matches[0][1], matches[0][2], matches[0][3])
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	end := start
	if len(matches) > 1 {
		end, err = parseFrenchDateParts(matches[1][1], matches[1][2], matches[1][3])
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
	}
	return start, end, nil
}

func parseSchemaDates(startRaw, endRaw string) (time.Time, time.Time, error) {
	start, err := parseSchemaDate(startRaw)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	end, err := parseSchemaDate(endRaw)
	if err != nil {
		end = start
	}
	return start, end, nil
}

func parseSchemaDate(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, errors.New("missing schema date")
	}
	location := eventLocation()
	instantLayouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05-0700",
		"2006-01-02T15:04:05Z0700",
	}
	for _, layout := range instantLayouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return validateScrapedDate(parsed.In(location), value)
		}
	}

	localLayouts := []string{
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, layout := range localLayouts {
		if parsed, err := time.ParseInLocation(layout, value, location); err == nil {
			return validateScrapedDate(parsed, value)
		}
	}
	return time.Time{}, fmt.Errorf("invalid schema date %q", value)
}

func validateScrapedDate(value time.Time, raw string) (time.Time, error) {
	if value.Year() <= 2000 {
		return time.Time{}, fmt.Errorf("invalid schema date %q", raw)
	}
	return value, nil
}

func timesFromDates(startDate, endDate time.Time) (*string, *string) {
	if startDate.IsZero() || endDate.IsZero() {
		return nil, nil
	}
	start := startDate.Format("15:04:05")
	end := endDate.Format("15:04:05")
	if start == "00:00:00" && end == "00:00:00" {
		return nil, nil
	}
	return &start, &end
}

func normalizeEndDate(startDate, endDate time.Time) time.Time {
	for !endDate.IsZero() && endDate.Before(startDate) && endDate.Sub(startDate) > -48*time.Hour {
		endDate = endDate.Add(24 * time.Hour)
	}
	return endDate
}

func parseFrenchDateParts(dayRaw, monthRaw, yearRaw string) (time.Time, error) {
	day, err := strconv.Atoi(dayRaw)
	if err != nil {
		return time.Time{}, err
	}
	year, err := strconv.Atoi(yearRaw)
	if err != nil {
		return time.Time{}, err
	}
	month, ok := frenchMonths[monthRaw]
	if !ok {
		return time.Time{}, fmt.Errorf("unknown french month %q", monthRaw)
	}
	return time.Date(year, month, day, 0, 0, 0, 0, eventLocation()), nil
}

var frenchMonths = map[string]time.Month{
	"janvier":   time.January,
	"fevrier":   time.February,
	"mars":      time.March,
	"avril":     time.April,
	"mai":       time.May,
	"juin":      time.June,
	"juillet":   time.July,
	"aout":      time.August,
	"septembre": time.September,
	"octobre":   time.October,
	"novembre":  time.November,
	"decembre":  time.December,
}
