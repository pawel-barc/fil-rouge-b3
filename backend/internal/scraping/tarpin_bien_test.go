package scraping

import (
	"image"
	"image/color"
	"strings"
	"testing"
	"time"
)

func TestIsWithinMarseilleRadius(t *testing.T) {
	if !isWithinMarseilleRadius(43.4075, 5.0550) {
		t.Fatal("expected Martigues to be accepted inside the Marseille radius")
	}

	if isWithinMarseilleRadius(43.9493, 4.8055) {
		t.Fatal("expected Avignon to be rejected outside the Marseille radius")
	}
}

func TestDistanceInKilometers(t *testing.T) {
	distance := distanceInKilometers(marseilleLatitude, marseilleLongitude, 43.4075, 5.0550)
	if distance < 25 || distance > 35 {
		t.Fatalf("expected Marseille to Martigues distance around 30 km, got %.1f", distance)
	}
}

func TestParseFrenchDateRange(t *testing.T) {
	start, end, err := parseFrenchDateRange("Du 05 juin 2025 au 31 decembre 2026")
	if err != nil {
		t.Fatalf("parseFrenchDateRange returned error: %v", err)
	}

	if start.Format("2006-01-02") != "2025-06-05" {
		t.Fatalf("unexpected start date: %s", start.Format("2006-01-02"))
	}
	if end.Format("2006-01-02") != "2026-12-31" {
		t.Fatalf("unexpected end date: %s", end.Format("2006-01-02"))
	}
}

func TestParseSchemaDates(t *testing.T) {
	start, end, err := parseSchemaDates("2025-06-05T10:00:00+0000", "2026-12-31T19:00:00+0000")
	if err != nil {
		t.Fatalf("parseSchemaDates returned error: %v", err)
	}
	if got := formatEventDateTimeForDB(start); got != "2025-06-05 12:00:00" {
		t.Fatalf("unexpected schema start: %s", got)
	}
	if got := formatEventDateTimeForDB(end); got != "2026-12-31 20:00:00" {
		t.Fatalf("unexpected schema end: %s", got)
	}
}

func TestParseSchemaDateKeepsParisLocalDateTimeUnshifted(t *testing.T) {
	start, err := parseSchemaDate("2026-07-03T20:00:00")
	if err != nil {
		t.Fatalf("parseSchemaDate returned error: %v", err)
	}

	if got := formatEventDateTimeForDB(start); got != "2026-07-03 20:00:00" {
		t.Fatalf("expected local schema date to stay 20:00, got %s", got)
	}
}

func TestParseTimeRange(t *testing.T) {
	start, end := parseTimeRange("10h00 à 19h00")
	if start == nil || *start != "10:00:00" {
		t.Fatalf("unexpected start time: %#v", start)
	}
	if end == nil || *end != "19:00:00" {
		t.Fatalf("unexpected end time: %#v", end)
	}
}

func TestParsePrice(t *testing.T) {
	price := parsePrice("12,50 €")
	if price == nil || *price != 13 {
		t.Fatalf("expected rounded price 13, got %#v", price)
	}

	free := parsePrice("Gratuit")
	if free == nil || *free != 0 {
		t.Fatalf("expected free price 0, got %#v", free)
	}
}

func TestBestCategoryIDs(t *testing.T) {
	categories := []eventCategory{
		{ID: 1, Slug: "concert"},
		{ID: 2, Slug: "exposition"},
		{ID: 3, Slug: "sport"},
	}

	ids := bestCategoryIDs(categories, "Une exposition dans un musee avec des oeuvres")
	if len(ids) != 1 || ids[0] != 2 {
		t.Fatalf("expected exposition category, got %#v", ids)
	}
}

func TestDescriptionFromMarkupKeepsNonParagraphContent(t *testing.T) {
	markup := `
		<div class="description">
			<p>Premiere partie de la description.</p>
			<ul>
				<li>Information pratique importante</li>
				<li>Derniere entree a 18h</li>
			</ul>
			Texte final hors paragraphe avec un <a href="/billetterie">lien utile</a>.
		</div>
	`

	description := descriptionFromMarkup(markup)
	for _, expected := range []string{
		"Premiere partie de la description.",
		"- Information pratique importante",
		"- Derniere entree a 18h",
		"Texte final hors paragraphe avec un lien utile.",
	} {
		if !strings.Contains(description, expected) {
			t.Fatalf("expected description to contain %q, got %q", expected, description)
		}
	}
}

func TestExtractEventDescriptionKeepsAllWordPressParagraphs(t *testing.T) {
	markup := `
		<div class="description">
			<p class="wp-block-paragraph">Le 3XFestival c'est l'occasion de découvrir la nouvelle discipline du Basket 3x3 avec 3 jours de compétitions intenses !</p>
			<p class="wp-block-paragraph">Chaque jour, le 3XFestival accueillera des compétitions et animations pour le grand public. Des tournois organisés par la FFBB viendront animer les terrains du village, sur le parvis du Parc Chanot. Des initiations à la pratique olympique seront également disponibles pour le grand public, chaque jour.&nbsp;</p>
			<p class="wp-block-paragraph">Nos partenaires tels que POSCA ou la CEPAC animeront le village, avec des ateliers de custom ou test de produits.&nbsp;</p>
			<p class="wp-block-paragraph">Chaque jour prendra place les compétitions élites avec les meilleures joueuses et joueurs de la planète. Ce sont 3 journées &amp; soirées exceptionnelles qui seront proposées au public marseillais.&nbsp;</p>
			<p class="wp-block-paragraph">Prenez vos billets ! Ouverture de la billetterie le 15 Mai prochain.&nbsp;</p>
			<figure class="wp-block-image size-full"><img src="https://tarpin-bien.com/wp-content/uploads/2026/06/event.jpg" alt=""></figure>
		</div>
	`

	description, found, candidates := extractEventDescription(markup, "")
	if !found {
		t.Fatal("expected a description block to be found")
	}
	if candidates != 1 {
		t.Fatalf("expected 1 description candidate, got %d", candidates)
	}
	for _, expected := range []string{
		"Le 3XFestival c'est l'occasion",
		"Chaque jour, le 3XFestival accueillera",
		"Nos partenaires tels que POSCA",
		"Ce sont 3 journées & soirées exceptionnelles",
		"Prenez vos billets ! Ouverture de la billetterie le 15 Mai prochain.",
	} {
		if !strings.Contains(description, expected) {
			t.Fatalf("expected description to contain %q, got %q", expected, description)
		}
	}
	if strings.Contains(description, "https://tarpin-bien.com/wp-content/uploads") {
		t.Fatalf("expected image markup to be stripped, got %q", description)
	}
}

func TestExtractEventDescriptionChoosesFullestCandidate(t *testing.T) {
	markup := `
		<div class="description">
			<p>Description courte affichee ailleurs.</p>
		</div>
		<section class="tribe-events-single-event-description tribe-events-content">
			<p>Debut de la vraie description.</p>
			<p>Milieu avec des informations importantes.</p>
			Texte final visible dans le HTML.
		</section>
	`

	description, found, candidates := extractEventDescription(markup, "Fallback schema")
	if !found {
		t.Fatal("expected a description block to be found")
	}
	if candidates != 2 {
		t.Fatalf("expected 2 description candidates, got %d", candidates)
	}
	for _, expected := range []string{
		"Debut de la vraie description.",
		"Milieu avec des informations importantes.",
		"Texte final visible dans le HTML.",
	} {
		if !strings.Contains(description, expected) {
			t.Fatalf("expected full description to contain %q, got %q", expected, description)
		}
	}
	if strings.Contains(description, "Description courte") {
		t.Fatalf("expected short candidate to be ignored, got %q", description)
	}
}

func TestMissingScraperEventColumns(t *testing.T) {
	missing := missingScraperEventColumns(map[string]struct{}{
		"source_url":          {},
		"time_end":            {},
		"external_image_url":  {},
		"image_optimized_url": {},
		"image_thumbnail_url": {},
	})

	if len(missing) != 1 || missing[0] != "time_start" {
		t.Fatalf("expected only time_start to be missing, got %#v", missing)
	}

	none := missingScraperEventColumns(map[string]struct{}{
		"source_url":          {},
		"time_start":          {},
		"time_end":            {},
		"external_image_url":  {},
		"image_optimized_url": {},
		"image_thumbnail_url": {},
	})
	if len(none) != 0 {
		t.Fatalf("expected no missing columns, got %#v", none)
	}
}

func TestResizeImageDoesNotUpscale(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 20, 10))
	src.Set(0, 0, color.Black)

	resized := resizeImage(src, 200, 200)
	if resized.Bounds().Dx() != 20 || resized.Bounds().Dy() != 10 {
		t.Fatalf("expected original dimensions, got %dx%d", resized.Bounds().Dx(), resized.Bounds().Dy())
	}
}

func TestResizeImageKeepsAspectRatio(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 1200, 600))

	resized := resizeImage(src, 360, 270)
	if resized.Bounds().Dx() != 360 || resized.Bounds().Dy() != 180 {
		t.Fatalf("expected 360x180, got %dx%d", resized.Bounds().Dx(), resized.Bounds().Dy())
	}
}

func TestExtractImageSrcPrefersDisplayableLazySource(t *testing.T) {
	markup := `<img class="imagePrincipale" src="data:image/svg+xml,%3Csvg%3E" data-src="/uploads/event.jpg">`

	src := extractImageSrc(markup, "imagePrincipale")
	if src != "/uploads/event.jpg" {
		t.Fatalf("expected lazy image source, got %q", src)
	}
}

func TestBestSrcsetCandidateUsesLargestDisplayableSource(t *testing.T) {
	src := bestSrcsetCandidate("small.jpg 320w, medium.jpg 640w, large.jpg 1200w")
	if src != "large.jpg" {
		t.Fatalf("expected largest srcset candidate, got %q", src)
	}
}

func TestIsDisplayableImageURL(t *testing.T) {
	valid := isDisplayableImageURL("https://example.com/event.webp")
	if !valid {
		t.Fatal("expected https image URL to be displayable")
	}

	for _, rawURL := range []string{
		"",
		"data:image/svg+xml,%3Csvg%3E",
		"https://example.com/placeholder.svg",
		"/uploads/event.jpg",
	} {
		if isDisplayableImageURL(rawURL) {
			t.Fatalf("expected %q to be rejected", rawURL)
		}
	}
}

func TestParseSchemaDateRejectsSentinelYear(t *testing.T) {
	if _, err := parseSchemaDate("2000-11-30T00:00:00Z"); err == nil {
		t.Fatal("expected schema sentinel date to be rejected")
	}
}

func TestNextDailyRun(t *testing.T) {
	location := time.FixedZone("test", 3600)
	now := time.Date(2026, 6, 30, 0, 30, 0, 0, location)
	next := nextDailyRun(now, 1, 0)
	if next.Format(time.RFC3339) != "2026-06-30T01:00:00+01:00" {
		t.Fatalf("unexpected next run before target: %s", next.Format(time.RFC3339))
	}

	now = time.Date(2026, 6, 30, 1, 0, 0, 0, location)
	next = nextDailyRun(now, 1, 0)
	if next.Format(time.RFC3339) != "2026-07-01T01:00:00+01:00" {
		t.Fatalf("unexpected next run at target: %s", next.Format(time.RFC3339))
	}
}
