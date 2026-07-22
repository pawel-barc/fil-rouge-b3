package scraping

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"mappening/internal/media"

	"github.com/rs/zerolog/log"
)

const (
	scrapedImageDirectory = "scraped-events"
	maxRemoteImageBytes   = 10 << 20
	mainImageMaxWidth     = 1200
	mainImageMaxHeight    = 900
	thumbImageMaxWidth    = 360
	thumbImageMaxHeight   = 270
)

type scrapedImageURLs struct {
	OriginalURL  string
	OptimizedURL string
	ThumbnailURL string
}

type scrapedImageResult struct {
	URLs       scrapedImageURLs
	CacheHit   bool
	Downloaded bool
	Duration   time.Duration
}

func (s *TarpinBienService) optimizeScrapedImage(ctx context.Context, sourceURL string) (scrapedImageResult, error) {
	startedAt := time.Now()
	log.Info().
		Str("source", TarpinBienSource).
		Str("image_url", sourceURL).
		Str("stage", "image_processing").
		Msg("scraped image processing started")

	if cached, ok, err := s.findCachedImageURLs(ctx, sourceURL); err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("stage", "image_cache_lookup").
			Dur("duration", time.Since(startedAt)).
			Msg("scraped image cache lookup failed")
		return scrapedImageResult{}, err
	} else if ok {
		duration := time.Since(startedAt)
		log.Info().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("optimized_url", cached.OptimizedURL).
			Str("thumbnail_url", cached.ThumbnailURL).
			Str("stage", "image_processing").
			Bool("cache_hit", true).
			Dur("duration", duration).
			Msg("scraped image processing completed from cache")
		return scrapedImageResult{URLs: cached, CacheHit: true, Duration: duration}, nil
	}

	data, contentType, err := s.downloadRemoteImage(ctx, sourceURL)
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("stage", "image_download").
			Dur("duration", time.Since(startedAt)).
			Msg("scraped image download failed")
		return scrapedImageResult{}, err
	}

	storage := media.NewLocalStorage(s.mediaUploadDir)
	baseName := imageCacheKey(sourceURL)

	if contentType == "image/webp" {
		urls, err := s.saveWebPAsCachedImage(ctx, storage, sourceURL, baseName, data)
		if err != nil {
			log.Error().
				Err(err).
				Stack().
				Str("source", TarpinBienSource).
				Str("image_url", sourceURL).
				Str("stage", "image_save").
				Dur("duration", time.Since(startedAt)).
				Msg("scraped image save failed")
			return scrapedImageResult{}, err
		}
		duration := time.Since(startedAt)
		log.Info().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("optimized_url", urls.OptimizedURL).
			Str("thumbnail_url", urls.ThumbnailURL).
			Str("content_type", contentType).
			Str("stage", "image_processing").
			Bool("downloaded", true).
			Dur("duration", duration).
			Msg("scraped image processing completed")
		return scrapedImageResult{URLs: urls, Downloaded: true, Duration: duration}, nil
	}

	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		err = fmt.Errorf("decode remote image: %w", err)
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("content_type", contentType).
			Str("stage", "image_decode").
			Dur("duration", time.Since(startedAt)).
			Msg("scraped image decode failed")
		return scrapedImageResult{}, err
	}

	mainData, mainExtension, err := encodeOptimizedImage(ctx, resizeImage(decoded, mainImageMaxWidth, mainImageMaxHeight), 78)
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("stage", "image_encode_main").
			Dur("duration", time.Since(startedAt)).
			Msg("scraped image main encoding failed")
		return scrapedImageResult{}, err
	}
	thumbData, thumbExtension, err := encodeOptimizedImage(ctx, resizeImage(decoded, thumbImageMaxWidth, thumbImageMaxHeight), 72)
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("stage", "image_encode_thumbnail").
			Dur("duration", time.Since(startedAt)).
			Msg("scraped image thumbnail encoding failed")
		return scrapedImageResult{}, err
	}

	mainStored, err := storage.Save(ctx, scrapedImageDirectory, baseName+"-main"+mainExtension, mainData)
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("stage", "image_save_main").
			Dur("duration", time.Since(startedAt)).
			Msg("scraped image main save failed")
		return scrapedImageResult{}, err
	}
	thumbStored, err := storage.Save(ctx, scrapedImageDirectory, baseName+"-thumb"+thumbExtension, thumbData)
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("image_url", sourceURL).
			Str("stage", "image_save_thumbnail").
			Dur("duration", time.Since(startedAt)).
			Msg("scraped image thumbnail save failed")
		return scrapedImageResult{}, err
	}

	urls := scrapedImageURLs{
		OriginalURL:  sourceURL,
		OptimizedURL: mainStored.PublicURL,
		ThumbnailURL: thumbStored.PublicURL,
	}
	duration := time.Since(startedAt)
	log.Info().
		Str("source", TarpinBienSource).
		Str("image_url", sourceURL).
		Str("optimized_url", urls.OptimizedURL).
		Str("thumbnail_url", urls.ThumbnailURL).
		Str("content_type", contentType).
		Int("downloaded_bytes", len(data)).
		Int("optimized_bytes", len(mainData)).
		Int("thumbnail_bytes", len(thumbData)).
		Str("stage", "image_processing").
		Bool("downloaded", true).
		Dur("duration", duration).
		Msg("scraped image processing completed")
	return scrapedImageResult{URLs: urls, Downloaded: true, Duration: duration}, nil
}

func (s *TarpinBienService) findCachedImageURLs(ctx context.Context, sourceURL string) (scrapedImageURLs, bool, error) {
	var optimizedURL sql.NullString
	var thumbnailURL sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT image_optimized_url, image_thumbnail_url
		FROM events
		WHERE external_image_url = $1
		  AND image_optimized_url IS NOT NULL
		  AND image_thumbnail_url IS NOT NULL
		  AND image_optimized_url <> ''
		  AND image_thumbnail_url <> ''
		ORDER BY created_at DESC
		LIMIT 1
	`, sourceURL).Scan(&optimizedURL, &thumbnailURL)
	if err != nil {
		if err == sql.ErrNoRows {
			return scrapedImageURLs{}, false, nil
		}
		return scrapedImageURLs{}, false, fmt.Errorf("find cached scraped image: %w", err)
	}
	if !optimizedURL.Valid || !thumbnailURL.Valid {
		return scrapedImageURLs{}, false, nil
	}
	return scrapedImageURLs{
		OriginalURL:  sourceURL,
		OptimizedURL: optimizedURL.String,
		ThumbnailURL: thumbnailURL.String,
	}, true, nil
}

func (s *TarpinBienService) downloadRemoteImage(ctx context.Context, sourceURL string) ([]byte, string, error) {
	startedAt := time.Now()
	log.Info().
		Str("source", TarpinBienSource).
		Str("method", http.MethodGet).
		Str("image_url", sourceURL).
		Str("stage", "image_download").
		Msg("scraped image download started")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "MappeningBot/1.0 (+https://mappening.local)")
	req.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/*")

	res, err := s.httpClient.Do(req)
	if err != nil {
		log.Error().
			Err(err).
			Stack().
			Str("source", TarpinBienSource).
			Str("method", http.MethodGet).
			Str("image_url", sourceURL).
			Str("stage", "image_download").
			Dur("duration", time.Since(startedAt)).
			Msg("scraped image network request failed")
		return nil, "", err
	}
	defer res.Body.Close()
	log.Info().
		Str("source", TarpinBienSource).
		Str("method", http.MethodGet).
		Str("image_url", sourceURL).
		Int("status_code", res.StatusCode).
		Str("content_type", res.Header.Get("Content-Type")).
		Str("stage", "image_download").
		Dur("duration", time.Since(startedAt)).
		Msg("scraped image response received")

	if err := validateImageResponse(res); err != nil {
		return nil, "", err
	}

	data, err := io.ReadAll(io.LimitReader(res.Body, maxRemoteImageBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read remote image: %w", err)
	}
	if len(data) == 0 {
		return nil, "", fmt.Errorf("remote image is empty")
	}
	if len(data) > maxRemoteImageBytes {
		return nil, "", fmt.Errorf("remote image exceeds %d bytes", maxRemoteImageBytes)
	}

	contentType := normalizeContentType(res.Header.Get("Content-Type"))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = normalizeContentType(http.DetectContentType(data))
	}
	if !strings.HasPrefix(contentType, "image/") || contentType == "image/svg+xml" {
		return nil, "", fmt.Errorf("content type %q", contentType)
	}

	log.Info().
		Str("source", TarpinBienSource).
		Str("method", http.MethodGet).
		Str("image_url", sourceURL).
		Int("status_code", res.StatusCode).
		Str("content_type", contentType).
		Int("bytes", len(data)).
		Str("stage", "image_download").
		Dur("duration", time.Since(startedAt)).
		Msg("scraped image download completed")
	return data, contentType, nil
}

func (s *TarpinBienService) saveWebPAsCachedImage(ctx context.Context, storage media.LocalStorage, sourceURL string, baseName string, data []byte) (scrapedImageURLs, error) {
	mainStored, err := storage.Save(ctx, scrapedImageDirectory, baseName+"-main.webp", data)
	if err != nil {
		return scrapedImageURLs{}, err
	}
	thumbStored, err := storage.Save(ctx, scrapedImageDirectory, baseName+"-thumb.webp", data)
	if err != nil {
		return scrapedImageURLs{}, err
	}
	return scrapedImageURLs{
		OriginalURL:  sourceURL,
		OptimizedURL: mainStored.PublicURL,
		ThumbnailURL: thumbStored.PublicURL,
	}, nil
}

func resizeImage(src image.Image, maxWidth int, maxHeight int) image.Image {
	bounds := src.Bounds()
	srcWidth := bounds.Dx()
	srcHeight := bounds.Dy()
	if srcWidth <= 0 || srcHeight <= 0 {
		return src
	}

	scale := minFloat(
		float64(maxWidth)/float64(srcWidth),
		float64(maxHeight)/float64(srcHeight),
	)
	if scale >= 1 {
		return flattenImage(src, srcWidth, srcHeight)
	}

	dstWidth := maxInt(1, int(float64(srcWidth)*scale))
	dstHeight := maxInt(1, int(float64(srcHeight)*scale))
	dst := image.NewRGBA(image.Rect(0, 0, dstWidth, dstHeight))

	for y := 0; y < dstHeight; y++ {
		srcY := bounds.Min.Y + int(float64(y)*float64(srcHeight)/float64(dstHeight))
		for x := 0; x < dstWidth; x++ {
			srcX := bounds.Min.X + int(float64(x)*float64(srcWidth)/float64(dstWidth))
			dst.Set(x, y, flattenColor(src.At(srcX, srcY)))
		}
	}

	return dst
}

func flattenImage(src image.Image, width int, height int) image.Image {
	bounds := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			dst.Set(x, y, flattenColor(src.At(bounds.Min.X+x, bounds.Min.Y+y)))
		}
	}
	return dst
}

func flattenColor(value color.Color) color.Color {
	r, g, b, a := value.RGBA()
	if a == 0xffff {
		return color.RGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8), A: 0xff}
	}
	if a == 0 {
		return color.White
	}

	const white = 0xffff
	r = minUint32(white, r+white-a)
	g = minUint32(white, g+white-a)
	b = minUint32(white, b+white-a)

	return color.RGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8), A: 0xff}
}

func encodeOptimizedJPEG(img image.Image, quality int) ([]byte, error) {
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode optimized image: %w", err)
	}
	return buffer.Bytes(), nil
}

func encodeOptimizedImage(ctx context.Context, img image.Image, quality int) ([]byte, string, error) {
	if data, ok, err := encodeWebPWithCWebP(ctx, img, quality); err != nil {
		return nil, "", err
	} else if ok {
		return data, ".webp", nil
	}

	data, err := encodeOptimizedJPEG(img, quality)
	if err != nil {
		return nil, "", err
	}
	return data, ".jpg", nil
}

func encodeWebPWithCWebP(ctx context.Context, img image.Image, quality int) ([]byte, bool, error) {
	if _, err := exec.LookPath("cwebp"); err != nil {
		return nil, false, nil
	}

	input, err := os.CreateTemp("", "mappening-scraped-image-*.png")
	if err != nil {
		return nil, false, fmt.Errorf("create webp input temp file: %w", err)
	}
	inputPath := input.Name()
	defer func() {
		_ = os.Remove(inputPath)
	}()

	if err := png.Encode(input, img); err != nil {
		_ = input.Close()
		return nil, false, fmt.Errorf("encode webp input image: %w", err)
	}
	if err := input.Close(); err != nil {
		return nil, false, fmt.Errorf("close webp input image: %w", err)
	}

	output, err := os.CreateTemp("", "mappening-scraped-image-*.webp")
	if err != nil {
		return nil, false, fmt.Errorf("create webp output temp file: %w", err)
	}
	outputPath := output.Name()
	if err := output.Close(); err != nil {
		_ = os.Remove(outputPath)
		return nil, false, fmt.Errorf("close webp output temp file: %w", err)
	}
	defer func() {
		_ = os.Remove(outputPath)
	}()

	cmd := exec.CommandContext(ctx, "cwebp", "-quiet", "-q", fmt.Sprintf("%d", quality), inputPath, "-o", outputPath)
	if err := cmd.Run(); err != nil {
		return nil, false, nil
	}

	data, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, false, fmt.Errorf("read webp output image: %w", err)
	}
	if len(data) == 0 {
		return nil, false, nil
	}
	return data, true, nil
}

func imageCacheKey(sourceURL string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(sourceURL)))
	return hex.EncodeToString(sum[:])[:32]
}

func normalizeContentType(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
}

func minFloat(a float64, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func minUint32(a uint32, b uint32) uint32 {
	if a < b {
		return a
	}
	return b
}
