/**Ce fichier définit les types liés aux événements
 * Il permet de structurer les données utilisées par la carte, les filtres et les affichages(popup, liste, etc.)*/

/**Liste des catégories possibles pour les événements. */
export const EVENT_CATEGORIES = [
  "musique",
  "culture",
  "art",
  "sport",
  "food",
  "famille",
  "festival",
  "vie_nocturne",
  "conference",
  "associatif",
  "tourisme",
] as const; /** "as const" permet de dire à TypeScript que les valeurs sont fixes (read only) */

/**Création du type EventCategory à partir du tableau EVENT_CATEGORIES
 * "typeof EVENT_CATEGORIES" récupère le type du tableau, "[number]" signifie : prends n'importe quel élément du tableau*/
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/**Type principal représentant un événement */
export type Event = {
  id: number;
  title: string;
  description: string;
  date: string;
  latitude: number;
  longitude: number;
  category: EventCategory;
  image?: string;
  source?: string;
  company_id?: number | null;
};
