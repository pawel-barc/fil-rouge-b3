export const EVENT_CATEGORY_OPTIONS = [
  { id: 1, name: "animaux", slug: "animaux", label: "animaux" },
  { id: 2, name: "art", slug: "art", label: "art" },
  { id: 3, name: "associatif", slug: "associatif", label: "associatif" },
  { id: 4, name: "atelier", slug: "atelier", label: "atelier" },
  { id: 5, name: "automobile", slug: "automobile", label: "automobile" },
  { id: 6, name: "bien-etre", slug: "bien-etre", label: "bien-être" },
  { id: 7, name: "business", slug: "business", label: "business" },
  { id: 8, name: "cinema", slug: "cinema", label: "cinéma" },
  { id: 9, name: "concert", slug: "concert", label: "concert" },
  { id: 10, name: "conference", slug: "conference", label: "conférence" },
  { id: 11, name: "culture", slug: "culture", label: "culture" },
  { id: 12, name: "emploi", slug: "emploi", label: "emploi" },
  { id: 13, name: "enfants", slug: "enfants", label: "enfants" },
  { id: 14, name: "esport", slug: "esport", label: "esport" },
  { id: 15, name: "famille", slug: "famille", label: "famille" },
  { id: 16, name: "festival", slug: "festival", label: "festival" },
  { id: 17, name: "food", slug: "food", label: "food" },
  { id: 18, name: "formation", slug: "formation", label: "formation" },
  { id: 19, name: "gaming", slug: "gaming", label: "gaming" },
  { id: 20, name: "gastronomie", slug: "gastronomie", label: "gastronomie" },
  { id: 21, name: "humour", slug: "humour", label: "humour" },
  { id: 22, name: "jeux", slug: "jeux", label: "jeux" },
  { id: 23, name: "marche", slug: "marche", label: "marché" },
  { id: 24, name: "mode", slug: "mode", label: "mode" },
  { id: 25, name: "musique", slug: "musique", label: "musique" },
  { id: 26, name: "nature", slug: "nature", label: "nature" },
  { id: 27, name: "networking", slug: "networking", label: "networking" },
  { id: 28, name: "nightlife", slug: "nightlife", label: "nightlife" },
  { id: 29, name: "patrimoine", slug: "patrimoine", label: "patrimoine" },
  { id: 30, name: "plein-air", slug: "plein-air", label: "plein air" },
  { id: 31, name: "randonnee", slug: "randonnee", label: "randonnée" },
  { id: 32, name: "sante", slug: "sante", label: "santé" },
  { id: 33, name: "shopping", slug: "shopping", label: "shopping" },
  { id: 34, name: "solidarite", slug: "solidarite", label: "solidarité" },
  { id: 35, name: "soiree", slug: "soiree", label: "soirée" },
  { id: 36, name: "spectacle", slug: "spectacle", label: "spectacle" },
  { id: 37, name: "sport", slug: "sport", label: "sport" },
  { id: 38, name: "technologie", slug: "technologie", label: "technologie" },
  { id: 39, name: "theatre", slug: "theatre", label: "théâtre" },
  { id: 40, name: "tourisme", slug: "tourisme", label: "tourisme" },
  { id: 41, name: "etudiant", slug: "etudiant", label: "étudiant" },
  { id: 42, name: "exposition", slug: "exposition", label: "exposition" },
] as const;

export type EventCategoryOption = (typeof EVENT_CATEGORY_OPTIONS)[number];
export type EventCategoryName = EventCategoryOption["slug"];
export type EventCategory = EventCategoryName;

export const EVENT_CATEGORIES = EVENT_CATEGORY_OPTIONS.map(
  (category) => category.slug,
);

export const getEventCategoryById = (id: number) =>
  EVENT_CATEGORY_OPTIONS.find((category) => category.id === id);

export const getEventCategoryBySlug = (slug: EventCategoryName) =>
  EVENT_CATEGORY_OPTIONS.find((category) => category.slug === slug);

export const getEventCategoryId = (slug: EventCategoryName) => {
  const category = getEventCategoryBySlug(slug);

  if (!category) {
    throw new Error(`Unknown event category slug: ${slug}`);
  }

  return category.id;
};

export const getEventCategorySlug = (id: number) =>
  getEventCategoryById(id)?.slug;

export const getEventCategoryLabel = (slug: EventCategoryName) =>
  getEventCategoryBySlug(slug)?.label ?? slug;

export type { Event } from "./event";
