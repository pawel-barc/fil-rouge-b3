export const ORGANIZATION_CATEGORY_OPTIONS = [
  { slug: "art", label: "art" },
  { slug: "associatif", label: "associatif" },
  { slug: "bien-etre", label: "bien-être" },
  { slug: "business", label: "business" },
  { slug: "culture", label: "culture" },
  { slug: "famille", label: "famille" },
  { slug: "formation", label: "formation" },
  { slug: "gaming", label: "gaming" },
  { slug: "gastronomie", label: "gastronomie" },
  { slug: "musique", label: "musique" },
  { slug: "nature", label: "nature" },
  { slug: "sport", label: "sport" },
  { slug: "soiree", label: "soirée" },
  { slug: "technologie", label: "technologie" },
  { slug: "tourisme", label: "tourisme" },
] as const;

export const ORGANIZATION_CATEGORIES = ORGANIZATION_CATEGORY_OPTIONS.map(
  (category) => category.slug,
);

export const CATEGORIES = ORGANIZATION_CATEGORIES;

export type OrganizationCategoryName = (typeof ORGANIZATION_CATEGORIES)[number];
export type CategoryName = OrganizationCategoryName;

export const getOrganizationCategoryLabel = (slug: OrganizationCategoryName) =>
  ORGANIZATION_CATEGORY_OPTIONS.find((category) => category.slug === slug)?.label ??
  slug;
