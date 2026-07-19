import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import CategorySelect from "../../event/components/CategorySelect";
import { eventsApi } from "../../event/api/events.api";
import useAuthStore from "../../auth/store/authStore";
import type { EventCategory } from "../../event/types/event-categories";
import type { Event } from "../../event/types/event";
import Button from "../../../shared/components/ui/Button";
import AddressAutocomplete from "../../../shared/components/forms/AddressAutocomplete";
import FormField from "../../../shared/components/ui/FormField";
import ImageField from "../../../shared/components/forms/ImageField";
import Input from "../../../shared/components/ui/Input";
import Select from "../../../shared/components/ui/Select";
import Textarea from "../../../shared/components/ui/Textarea";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import useDataStore from "../../../shared/store/dataStore";
import { ROUTES } from "../../../shared/constants/routes";
import { getCurrentUserOrganizationMemberships } from "../utils/organizerAccess";
import type { Organization } from "../types/organization";
import {
  emptyEventForm,
  validateEventForm,
  type EventForm,
  type EventFormErrors,
} from "../utils/organizationWorkflow";
import { toEventDateTimePayload } from "../../event/utils/event";

export default function OrganizationDashboard() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const upsertEvents = useDataStore((s) => s.upsertEvents);
  const organizations = useDataStore((s) => s.organizations);
  const organizers = useDataStore((s) => s.organizers);
  const manageableOrganizations = useMemo(() => {
    const memberships = getCurrentUserOrganizationMemberships(
      currentUser,
      organizers,
      organizations,
    ).map(({ organization }) => organization);
    const selectableOrganizations = memberships.filter(
      (organization): organization is Organization =>
        !!organization && organization.is_active && organization.is_verified,
    );
    const organizationsById = new Map(
      selectableOrganizations.map((organization) => [organization.id, organization]),
    );

    return Array.from(organizationsById.values());
  }, [currentUser, organizers, organizations]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<number | null>(
    () => manageableOrganizations[0]?.id ?? null,
  );
  const [form, setForm] = useState<EventForm>(emptyEventForm);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedOrganization =
    manageableOrganizations.find(
      (organization) => organization.id === selectedOrganizationId,
    ) ?? manageableOrganizations[0];

  const updateField = <Key extends keyof EventForm>(
    field: Key,
    value: EventForm[Key],
  ) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
    setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
  };

  const toggleCategory = (category: EventCategory) => {
    updateField(
      "categories",
      form.categories.includes(category)
        ? form.categories.filter((item) => item !== category)
        : [...form.categories, category],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    if (!selectedOrganization) {
      setServerError("Impossible d'identifier l'organisation connectée");
      return;
    }

    const validationErrors = validateEventForm(form);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }
    setIsSubmitting(true);

    const newEvent: Omit<Event, "id" | "created_at" | "updated_at"> = {
      organization_id: selectedOrganization.id,
      title: form.title.trim(),
      description: form.description.trim(),
      start_date: toEventDateTimePayload(form.start_date),
      end_date: toEventDateTimePayload(form.end_date),
      address: form.address.trim(),
      city: form.city.trim(),
      postal_code: form.postal_code.trim(),
      category_slugs: form.categories,
      image: form.image.trim(),
      price: Number(form.price.trim()),
      ticketing_link: form.ticketing_link.trim(),
      source: "Événement créé par une organisation",
      is_active: false,
    };

    const result = await eventsApi.create(newEvent);

    if (!result.ok) {
      setServerError(result.error.message);
      setIsSubmitting(false);
      return;
    }

    const persistedResult = await eventsApi.listManagedByOrganization(
      selectedOrganization.id,
    );

    if (
      !persistedResult.ok ||
      !persistedResult.data.some((event) => event.id === result.data.id)
    ) {
      setServerError(
        "L'événement a été envoyé, mais il n'a pas pu être confirmé en base. Rechargez la page ou réessayez.",
      );
      setIsSubmitting(false);
      return;
    }

    upsertEvents(persistedResult.data);
    setForm(emptyEventForm());
    toast.success("Événement envoyé en attente de publication");
    setIsSubmitting(false);
    navigate(ROUTES.USER.EVENTS);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 });
    });
  };

  if (manageableOrganizations.length === 0) {
    return (
      <div className="organization-dashboard">
        <h2>Aucune organisation validee</h2>
        <p>
          Vous devez créer une organisation et attendre sa validation avant de
          pouvoir créer des événements.
        </p>
      </div>
    );
  }

  if (selectedOrganizationId === Number.NEGATIVE_INFINITY) {
    return (
      <div className="organization-dashboard">
        <h2>Aucune organisation validee</h2>
        <p>
          Votre compte doit etre valide par un administrateur avant de pouvoir
          créer des événements.
        </p>
      </div>
    );
  }

  return (
    <div className="organization-dashboard">
      <section className="organization-dashboard__header">
        <h2>Nouvel événement</h2>
        <p>Ajoutez un événement public rattaché à votre organisation.</p>
      </section>

      <section
        className="organization-event-form"
        aria-labelledby="organization-event-form-title"
      >
        <form onSubmit={handleSubmit} noValidate>
          <div className="organization-event-form__grid">
            {manageableOrganizations.length > 1 && (
              <FormField
                label="Organisation"
                htmlFor="event-organization"
                error={
                  selectedOrganization ? undefined : "Sélectionnez une organisation"
                }
              >
                <Select
                  id="event-organization"
                  value={selectedOrganizationId ?? ""}
                  hasError={!selectedOrganization}
                  onChange={(event) =>
                    setSelectedOrganizationId(Number(event.target.value))
                  }
                >
                  {manageableOrganizations.map((organization) => (
                    <option value={organization.id} key={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}

            <FormField label="Titre" htmlFor="event-title" error={errors.title}>
              <Input
                id="event-title"
                type="text"
                value={form.title}
                hasError={!!errors.title}
                aria-describedby={
                  errors.title ? "event-title-error" : undefined
                }
                onChange={(event) => updateField("title", event.target.value)}
              />
            </FormField>

            <div id="event-categories" className="organization-event-form__wide">
              <CategorySelect
                error={errors.categories}
                labelId="event-categories-label"
                selected={form.categories}
                onToggle={toggleCategory}
              />
            </div>

            <div className="organization-event-form__wide">
              <FormField
                label="Description"
                htmlFor="event-description"
                error={errors.description}
              >
                <Textarea
                  id="event-description"
                  hasError={!!errors.description}
                  rows={4}
                  value={form.description}
                  aria-describedby={
                    errors.description ? "event-description-error" : undefined
                  }
                  onChange={(event) =>
                    updateField("description", event.target.value)
                  }
                />
              </FormField>
            </div>

            <FormField
              label="Date de debut"
              htmlFor="event-start-date"
              error={errors.start_date}
            >
              <Input
                id="event-start-date"
                type="datetime-local"
                value={form.start_date}
                hasError={!!errors.start_date}
                aria-describedby={
                  errors.start_date ? "event-start-date-error" : undefined
                }
                onChange={(event) =>
                  updateField("start_date", event.target.value)
                }
              />
            </FormField>

            <FormField
              label="Date de fin"
              htmlFor="event-end-date"
              error={errors.end_date}
            >
              <Input
                id="event-end-date"
                type="datetime-local"
                value={form.end_date}
                hasError={!!errors.end_date}
                aria-describedby={
                  errors.end_date ? "event-end-date-error" : undefined
                }
                onChange={(event) =>
                  updateField("end_date", event.target.value)
                }
              />
            </FormField>

            <AddressAutocomplete
              errors={{
                address: errors.address,
                city: errors.city,
                postal_code: errors.postal_code,
              }}
              ids={{
                address: "event-address",
                city: "event-city",
                postalCode: "event-postal-code",
              }}
              value={{
                address: form.address,
                city: form.city,
                postal_code: form.postal_code,
              }}
              onChange={updateField}
            />

            <ImageField
              className="organization-event-form__wide"
              id="event-image"
              value={form.image}
              error={errors.image}
              onChange={(value) => updateField("image", value)}
            />

            <FormField label="Prix" htmlFor="event-price" error={errors.price}>
              <Input
                id="event-price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                hasError={!!errors.price}
                aria-describedby={errors.price ? "event-price-error" : undefined}
                onChange={(event) => updateField("price", event.target.value)}
              />
            </FormField>

            <FormField
              label="Lien de billetterie"
              htmlFor="event-ticketing-link"
              error={errors.ticketing_link}
            >
              <Input
                id="event-ticketing-link"
                type="url"
                value={form.ticketing_link}
                hasError={!!errors.ticketing_link}
                aria-describedby={
                  errors.ticketing_link ? "event-ticketing-link-error" : undefined
                }
                onChange={(event) =>
                  updateField("ticketing_link", event.target.value)
                }
              />
            </FormField>
          </div>

          {serverError && <ErrorMessage message={serverError} />}

          <Button type="submit" loading={isSubmitting} loadingLabel="Envoi...">
            Ajouter l'événement
          </Button>
        </form>
      </section>
    </div>
  );
}
