import type { StatusBadgeVariant } from "../../../shared/components/ui/StatusBadge";
import type { Event } from "../../event/types/event";
import type { EventCategory } from "../../event/types/event-categories";
import { isEventSuspended, toDateTimeLocalValue } from "../../event/utils/event";
import {
  eventFormSchema,
  getZodFieldErrors,
} from "../../event/validations/event.schema";
import type { Organization } from "../types/organization";
import {
  CATEGORIES,
  type OrganizationCategoryName,
} from "../types/organization-categories";
import { organizationFormSchema } from "../validations/organization.schema";

export type OrganizerProfileForm = {
  job_role: string;
};

export type OrganizerProfileErrors = Partial<Record<keyof OrganizerProfileForm, string>>;

export type OrganizationForm = {
  name: string;
  contact_email: string;
  description: string;
  website: string;
  address: string;
  city: string;
  postal_code: string;
  logo: string;
  contact_phone_number: string;
  siret: string;
  categories: OrganizationCategoryName[];
};

export type OrganizationFormErrors = Partial<Record<keyof OrganizationForm, string>>;

export type EventForm = {
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  address: string;
  city: string;
  postal_code: string;
  categories: EventCategory[];
  image: string;
  price: string;
  ticketing_link: string;
  source: string;
};

export type EventFormErrors = Partial<Record<keyof EventForm, string>>;

export const normalizeComparable = (value: string) => value.trim().toLowerCase();

export const emptyOrganizerProfileForm = (): OrganizerProfileForm => ({
  job_role: "",
});

export const emptyOrganizationForm = (): OrganizationForm => ({
  name: "",
  contact_email: "",
  description: "",
  website: "",
  address: "",
  city: "",
  postal_code: "",
  logo: "",
  contact_phone_number: "",
  siret: "",
  categories: [],
});

export const emptyEventForm = (): EventForm => ({
  title: "",
  description: "",
  start_date: "",
  end_date: "",
  address: "",
  city: "",
  postal_code: "",
  categories: [],
  image: "",
  price: "0",
  ticketing_link: "",
  source: "",
});

export const toOrganizationForm = (organization: Organization): OrganizationForm => ({
  name: organization.name,
  contact_email: organization.contact_email,
  description: organization.description ?? "",
  website: organization.website ?? "",
  address: organization.address,
  city: organization.city,
  postal_code: organization.postal_code,
  logo: organization.logo ?? "",
  contact_phone_number: organization.contact_phone_number ?? "",
  siret: organization.siret ?? "",
  categories: organization.category_slugs.filter(
    (category): category is OrganizationCategoryName =>
      CATEGORIES.includes(category as OrganizationCategoryName),
  ),
});

export const toEventForm = (event: Event): EventForm => ({
  title: event.title,
  description: event.description,
  start_date: toDateTimeLocalValue(event.start_date),
  end_date: toDateTimeLocalValue(event.end_date),
  address: event.address,
  city: event.city,
  postal_code: event.postal_code,
  categories: event.category_slugs,
  image: event.image,
  price: event.price.toString(),
  ticketing_link: event.ticketing_link,
  source: event.source ?? "",
});

export const validateOrganizerProfileForm = (
  form: OrganizerProfileForm,
): OrganizerProfileErrors => {
  const errors: OrganizerProfileErrors = {};

  if (form.job_role.trim().length < 2) {
    errors.job_role = "Indiquez votre fonction d'organisateur";
  }

  return errors;
};

export const validateOrganizationForm = (
  form: OrganizationForm,
  organizations: Organization[],
  currentOrganizationId?: number,
): OrganizationFormErrors => {
  const errors: OrganizationFormErrors =
    getZodFieldErrors<keyof OrganizationForm>(
      organizationFormSchema.safeParse(form),
    );
  const contactEmail = form.contact_email.trim();
  const siret = form.siret.trim();

  const duplicatedEmail = organizations.some(
    (organization) =>
      organization.id !== currentOrganizationId &&
      !organization.deleted_at &&
      normalizeComparable(organization.contact_email) ===
        normalizeComparable(contactEmail),
  );

  if (duplicatedEmail) {
    errors.contact_email = "Cet email de contact est déjà utilisé";
  }

  const duplicatedSiret =
    siret !== "" &&
    organizations.some(
      (organization) =>
        organization.id !== currentOrganizationId &&
        !organization.deleted_at &&
        normalizeComparable(organization.siret ?? "") === normalizeComparable(siret),
    );

  if (duplicatedSiret) {
    errors.siret = "Ce SIRET est déjà utilisé";
  }

  return errors;
};

export const validateEventForm = (form: EventForm): EventFormErrors => {
  return getZodFieldErrors<keyof EventForm>(eventFormSchema.safeParse(form));
};

export const getOrganizationStatus = (organization: Organization) => {
  if (organization.deleted_at) {
    return { label: "Supprimée", variant: "danger" as StatusBadgeVariant };
  }

  if (organization.is_active && organization.is_verified) {
    return { label: "Active", variant: "active" as StatusBadgeVariant };
  }

  return {
    label: "En attente de validation",
    variant: "pending" as StatusBadgeVariant,
  };
};

export const getManagedEventStatus = (event: Event) => {
  if (event.deleted_at) {
    return { label: "Supprimé", variant: "danger" as StatusBadgeVariant };
  }

  if (isEventSuspended(event)) {
    return { label: "Suspendu", variant: "suspended" as StatusBadgeVariant };
  }

  if (event.is_active) {
    return { label: "Validé", variant: "active" as StatusBadgeVariant };
  }

  return {
    label: "En attente de validation",
    variant: "pending" as StatusBadgeVariant,
  };
};
