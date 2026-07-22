package httpx

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Ecrit une reponse JSON avec le code HTTP attendu.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Ecrit une erreur JSON au format standard de l'API.
func WriteJSONError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]string{
		"error": publicErrorMessage(message),
	})
}

// Decode un JSON en refusant les champs inconnus et les corps trop volumineux.
func DecodeStrictJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	const maxJSONBodyBytes = 1 << 20

	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("invalid json body")
	}

	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("invalid json body")
	}

	return nil
}

// publicErrorMessage transforme les erreurs techniques en messages lisibles.
func publicErrorMessage(message string) string {
	message = strings.TrimSpace(message)

	translations := map[string]string{
		"account already has an organization":                  "Ce compte possède déjà une organisation",
		"address could not be geocoded":                        "L'adresse n'a pas pu être géocodée",
		"address geocoding service unavailable":                "Le service de géocodage est indisponible",
		"all map bounds are required":                          "Toutes les limites de la carte sont obligatoires",
		"at least one event category is required":              "Sélectionnez au moins une catégorie d'événement",
		"auth service not configured":                          "Le service d'authentification est indisponible",
		"contact_email is invalid":                             "L'email de contact est invalide",
		"contact_email is required":                            "L'email de contact est obligatoire",
		"content type must be application/json":                "Le contenu doit être envoyé au format JSON",
		"current password is required":                         "Le mot de passe actuel est obligatoire",
		"description cannot contain control characters":        "La description contient des caractères non autorisés",
		"email already used":                                   "Cet email est déjà utilisé",
		"email and password are required":                      "L'email et le mot de passe sont obligatoires",
		"email is invalid":                                     "L'email est invalide",
		"email is required":                                    "L'email est obligatoire",
		"email is too long":                                    "L'email est trop long",
		"event category not found":                             "Catégorie d'événement introuvable",
		"event not found":                                      "Événement introuvable",
		"favorite not found":                                   "Favori introuvable",
		"free and paid filters cannot be combined":             "Les filtres gratuit et payant ne peuvent pas être combinés",
		"history not found":                                    "Historique introuvable",
		"include_inactive is not allowed":                      "Le filtre des éléments inactifs n'est pas autorisé",
		"insufficient permissions":                             "Permissions insuffisantes",
		"internal error":                                       "Une erreur interne est survenue",
		"invalid credentials":                                  "Email ou mot de passe incorrect",
		"invalid date":                                         "La date est invalide",
		"invalid date_from":                                    "La date de début est invalide",
		"invalid date_to":                                      "La date de fin est invalide",
		"invalid east bound":                                   "La limite est est invalide",
		"invalid json body":                                    "Le corps JSON est invalide",
		"invalid limit":                                        "La limite est invalide",
		"invalid north bound":                                  "La limite nord est invalide",
		"invalid offset":                                       "Le décalage est invalide",
		"invalid organization_id":                              "L'organisation est invalide",
		"invalid origin":                                       "Origine de la requête invalide",
		"invalid password":                                     "Mot de passe actuel incorrect",
		"invalid price_max":                                    "Le prix maximum est invalide",
		"invalid price_min":                                    "Le prix minimum est invalide",
		"invalid refresh token":                                "Session invalide. Veuillez vous reconnecter.",
		"invalid south bound":                                  "La limite sud est invalide",
		"invalid token":                                        "Jeton invalide",
		"invalid west bound":                                   "La limite ouest est invalide",
		"latitude must be between -90 and 90":                  "La latitude doit être comprise entre -90 et 90",
		"local dev login is only available from loopback":      "La connexion de développement est réservée à l'environnement local",
		"local dev login is only available on a loopback host": "La connexion de développement doit utiliser un hôte local",
		"longitude must be between -180 and 180":               "La longitude doit être comprise entre -180 et 180",
		"missing refresh token":                                "Session expirée. Veuillez vous reconnecter.",
		"name is required":                                     "Le nom est obligatoire",
		"no user":                                              "Utilisateur non authentifié",
		"organization category not found":                      "Catégorie d'organisation introuvable",
		"organization fields are required":                     "Les informations de l'organisation sont obligatoires",
		"organization is inactive":                             "L'organisation est inactive",
		"organization is not verified":                         "L'organisation n'est pas encore vérifiée",
		"organization not found":                               "Organisation introuvable",
		"organization siret already used":                      "Ce SIRET est déjà utilisé",
		"password cannot contain control characters":           "Le mot de passe contient des caractères non autorisés",
		"password cannot start or end with whitespace":         "Le mot de passe ne peut pas commencer ou se terminer par un espace",
		"password digit required":                              "Le mot de passe doit contenir au moins un chiffre",
		"password is required":                                 "Le mot de passe est obligatoire",
		"password lowercase required":                          "Le mot de passe doit contenir au moins une minuscule",
		"password special character required":                  "Le mot de passe doit contenir au moins un caractère spécial",
		"password too long":                                    "Le mot de passe est trop long",
		"password too short":                                   "Le mot de passe doit contenir au moins 8 caractères",
		"password uppercase required":                          "Le mot de passe doit contenir au moins une majuscule",
		"postal_code is required":                              "Le code postal est obligatoire",
		"price must be greater than or equal to 0":             "Le prix doit être supérieur ou égal à 0",
		"refresh token revoked":                                "Session révoquée. Veuillez vous reconnecter.",
		"request fields are too large":                         "Les champs de la requête sont trop volumineux",
		"south bound must be lower than north bound":           "La limite sud doit être inférieure à la limite nord",
		"token error":                                          "Erreur lors de la génération des jetons",
		"token is required":                                    "Le jeton est obligatoire",
		"user inactive":                                        "Ce compte est inactif ou suspendu",
		"user not found":                                       "Utilisateur introuvable",
		"username already used":                                "Ce nom d'utilisateur est déjà utilisé",
		"username cannot contain control characters":           "Le nom d'utilisateur contient des caractères non autorisés",
		"username is required":                                 "Le nom d'utilisateur est obligatoire",
		"username is too long":                                 "Le nom d'utilisateur est trop long",
		"west bound must be lower than east bound":             "La limite ouest doit être inférieure à la limite est",
		"you cannot delete your own account":                   "Vous ne pouvez pas supprimer votre propre compte",
		"you cannot remove your own active admin access":       "Vous ne pouvez pas retirer vos propres droits administrateur actifs",
	}

	if translated, ok := translations[message]; ok {
		return translated
	}

	if field, ok := strings.CutSuffix(message, " is too long"); ok {
		return fieldLabel(field) + " est trop long"
	}
	if field, ok := strings.CutSuffix(message, " cannot contain control characters"); ok {
		return fieldLabel(field) + " contient des caractères non autorisés"
	}
	if strings.HasPrefix(message, "http: request body too large") {
		return "La requête est trop volumineuse"
	}

	return message
}

// fieldLabel convertit quelques noms techniques en libelles utilisateur.
func fieldLabel(field string) string {
	switch strings.TrimSpace(field) {
	case "address":
		return "L'adresse"
	case "city":
		return "La ville"
	case "contact email":
		return "L'email de contact"
	case "contact_phone_number":
		return "Le numéro de téléphone"
	case "logo":
		return "Le logo"
	case "member job role":
		return "La fonction"
	case "name":
		return "Le nom"
	case "postal_code":
		return "Le code postal"
	case "siret":
		return "Le SIRET"
	case "website":
		return "Le site web"
	default:
		return "Le champ " + field
	}
}
