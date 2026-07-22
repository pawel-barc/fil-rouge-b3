package auth

import (
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Definit le contrat commun pour stocker et faire tourner les refresh tokens.
type RefreshTokenStore interface {
	Get(subject string) (string, bool, error)
	SetWithExpiry(subject, jti string, expiresAt time.Time) error
	CompareAndSwapWithExpiry(subject, currentJTI, nextJTI string, expiresAt time.Time) (bool, error)
	Delete(subject string) error
}

// Represente le JTI courant d'un refresh token et sa date d'expiration.
type refreshStoreEntry struct {
	jti       string
	expiresAt time.Time
}

// Stockage en memoire: subject(email) -> JTI courant du refresh token.
// Le contenu est perdu au redemarrage, donc un stockage persistant partage
// est necessaire pour un deploiement multi-instance.
type RefreshStore struct {
	mu   sync.RWMutex
	data map[string]refreshStoreEntry
}

// Cree un stockage memoire simple pour les refresh tokens.
func NewRefreshStore() *RefreshStore {
	return &RefreshStore{data: make(map[string]refreshStoreEntry)}
}

// Lit le JTI courant d'un utilisateur en purgeant au passage les entrees expirees.
func (s *RefreshStore) Get(subject string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.data[subject]
	if !ok {
		return "", false, nil
	}

	if !entry.expiresAt.IsZero() && time.Now().After(entry.expiresAt) {
		delete(s.data, subject)
		return "", false, nil
	}

	return entry.jti, true, nil
}

// Defini un refresh token sans date d'expiration explicite.
func (s *RefreshStore) Set(subject, jti string) error {
	return s.SetWithExpiry(subject, jti, time.Time{})
}

// Enregistre ou remplace le refresh token courant d'un utilisateur.
func (s *RefreshStore) SetWithExpiry(subject, jti string, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupExpiredLocked()
	s.data[subject] = refreshStoreEntry{
		jti:       jti,
		expiresAt: expiresAt,
	}

	return nil
}

// Remplace atomiquement un refresh token seulement si l'ancien correspond encore.
func (s *RefreshStore) CompareAndSwapWithExpiry(subject, currentJTI, nextJTI string, expiresAt time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupExpiredLocked()

	entry, ok := s.data[subject]
	if !ok || entry.jti != currentJTI {
		return false, nil
	}

	s.data[subject] = refreshStoreEntry{
		jti:       nextJTI,
		expiresAt: expiresAt,
	}

	return true, nil
}

// Supprime le refresh token associe a un utilisateur.
func (s *RefreshStore) Delete(subject string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, subject)
	return nil
}

// Purge les refresh tokens expires du stockage memoire.
func (s *RefreshStore) cleanupExpiredLocked() {
	now := time.Now()
	for subject, entry := range s.data {
		if !entry.expiresAt.IsZero() && now.After(entry.expiresAt) {
			delete(s.data, subject)
		}
	}
}

type DBRefreshStore struct {
	db *sql.DB
}

// Cree un stockage persistant des refresh tokens en base de donnees.
func NewDBRefreshStore(db *sql.DB) (*DBRefreshStore, error) {
	if db == nil {
		return nil, errors.New("db refresh store requires a database")
	}

	return &DBRefreshStore{db: db}, nil
}

// Lit le refresh token courant d'un sujet depuis la base.
func (s *DBRefreshStore) Get(subject string) (string, bool, error) {
	const query = `
		SELECT jti
		FROM auth_refresh_tokens
		WHERE subject = $1
		  AND expires_at > NOW()
		LIMIT 1
	`

	var jti string
	err := s.db.QueryRow(query, subject).Scan(&jti)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("get refresh token: %w", err)
	}

	return jti, true, nil
}

// Enregistre ou remplace le refresh token courant en base.
func (s *DBRefreshStore) SetWithExpiry(subject, jti string, expiresAt time.Time) error {
	const query = `
		INSERT INTO auth_refresh_tokens (subject, jti, expires_at, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (subject)
		DO UPDATE SET
			jti = EXCLUDED.jti,
			expires_at = EXCLUDED.expires_at,
			updated_at = NOW()
	`

	if _, err := s.db.Exec(query, subject, jti, expiresAt.UTC()); err != nil {
		return fmt.Errorf("set refresh token: %w", err)
	}

	return nil
}

// Remplace atomiquement le refresh token en base si l'ancien JTI est toujours valide.
func (s *DBRefreshStore) CompareAndSwapWithExpiry(subject, currentJTI, nextJTI string, expiresAt time.Time) (bool, error) {
	const query = `
		UPDATE auth_refresh_tokens
		SET
			jti = $3,
			expires_at = $4,
			updated_at = NOW()
		WHERE subject = $1
		  AND jti = $2
		  AND expires_at > NOW()
	`

	result, err := s.db.Exec(query, subject, currentJTI, nextJTI, expiresAt.UTC())
	if err != nil {
		return false, fmt.Errorf("compare and swap refresh token: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("compare and swap refresh token rows affected: %w", err)
	}

	return rowsAffected == 1, nil
}

// Supprime le refresh token persiste d'un utilisateur.
func (s *DBRefreshStore) Delete(subject string) error {
	if _, err := s.db.Exec(`DELETE FROM auth_refresh_tokens WHERE subject = $1`, subject); err != nil {
		return fmt.Errorf("delete refresh token: %w", err)
	}

	return nil
}
