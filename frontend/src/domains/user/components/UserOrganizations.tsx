import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import CategorySelect from "../../event/components/CategorySelect";
import { eventsApi } from "../../event/api/events.api";
import type { Organization } from "../../organization/types/organization";
import type { Event } from "../../event/types/event";
import type { EventCategory } from "../../event/types/event-categories";
import { isAccountSuspended } from "../types/user";
import {
  formatDateTime,
  formatEventDateRange,
  formatEventPrice,
  getTicketingHref,
  isValidOptionalUrl,
  isEventSuspended,
  toEventDateTimePayload,
  toDateTimeLocalValue,
} from "../../event/utils/event";
import useAuthStore from "../../auth/store/authStore";
import useDataStore from "../../../shared/store/dataStore";
import { getCurrentUserOrganizationMemberships } from "../../organization/utils/organizerAccess";
import ActionRow from "../../../shared/components/layout/ActionRow";
import ConfirmDialog from "../../../shared/components/forms/ConfirmDialog";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import FormModal from "../../../shared/components/forms/FormModal";
import AddressAutocomplete from "../../../shared/components/forms/AddressAutocomplete";
import ImageField from "../../../shared/components/forms/ImageField";
import Button from "../../../shared/components/ui/Button";
import FormField from "../../../shared/components/ui/FormField";
import Input from "../../../shared/components/ui/Input";
import Select from "../../../shared/components/ui/Select";
import StatusBadge from "../../../shared/components/ui/StatusBadge";
import Textarea from "../../../shared/components/ui/Textarea";
import { isValidUploadedImageValue } from "../../../shared/utils/imageUpload";

type EventForm = {
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

type EventFormErrors = Partial<Record<keyof EventForm, string>>;

type UserOrganization = {
  organization: Organization;
};

const toEventForm = (event: Event): EventForm => ({
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

const emptyEventForm = (): EventForm => ({
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

const validateEventForm = (form: EventForm): EventFormErrors => {
  const errors: EventFormErrors = {};

  if (form.title.trim().length < 3) {
    errors.title = "Le titre doit contenir au moins 3 caractères";
  }

  if (form.description.trim().length < 10) {
    errors.description = "La description doit contenir au moins 10 caractères";
  }

  if (!form.start_date) {
    errors.start_date = "La date de début est requise";
  }

  if (!form.end_date) {
    errors.end_date = "La date de fin est requise";
  }

  if (
    form.start_date &&
    form.end_date &&
    new Date(form.end_date) < new Date(form.start_date)
  ) {
    errors.end_date = "La date de fin doit être après la date de début";
  }

  if (form.categories.length === 0) {
    errors.categories = "Sélectionnez au moins une catégorie";
  }

  if (form.address.trim().length < 5) {
    errors.address = "L'adresse est requise";
  }

  if (form.city.trim().length < 2) {
    errors.city = "La ville est requise";
  }

  if (!/^\d{5}$/.test(form.postal_code.trim())) {
    errors.postal_code = "Le code postal doit contenir 5 chiffres";
  }

  if (!isValidUploadedImageValue(form.image)) {
    errors.image = "Ajoutez une image PNG, JPG ou WebP de 1 Mo maximum";
  }

  const price = Number(form.price.trim());

  if (!form.price.trim()) {
    errors.price = "Le prix est requis";
  } else if (Number.isNaN(price) || price < 0) {
    errors.price = "Le prix doit être un nombre positif ou égal à 0";
  }

  if (!isValidOptionalUrl(form.ticketing_link)) {
    errors.ticketing_link = "L'URL de billetterie est invalide";
  }

  return errors;
};

const getEventStatus = (event: Event) => {
  if (isEventSuspended(event)) {
    return { label: "Suspendu", variant: "suspended" as const };
  }

  return event.is_active
    ? { label: "Publié", variant: "active" as const }
    : { label: "En attente", variant: "pending" as const };
};

export default function UserOrganizations() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const organizers = useDataStore((s) => s.organizers);
  const accounts = useDataStore((s) => s.accounts);
  const allOrganizations = useDataStore((s) => s.organizations);
  const events = useDataStore((s) => s.events);
  const updateEvent = useDataStore((s) => s.updateEvent);
  const upsertEvents = useDataStore((s) => s.upsertEvents);
  const deleteEvent = useDataStore((s) => s.deleteEvent);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [eventOrganizationId, setEventOrganizationId] = useState<number | null>(null);
  const [eventForm, setEventForm] = useState<EventForm | null>(null);
  const [eventErrors, setEventErrors] = useState<EventFormErrors>({});
  const [pendingDeleteEventId, setPendingDeleteEventId] = useState<number | null>(
    null,
  );
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSavingEvent, setIsSavingEvent] = useState(false);

  const userOrganizations = useMemo<UserOrganization[]>(() => {
    return getCurrentUserOrganizationMemberships(
      currentUser,
      organizers,
      allOrganizations,
    )
      .filter(({ organization }) => {
        if (!organization.is_active || organization.deleted_at) return false;

        const account = accounts.find(
          (item) => item.id === organization.account_id && !item.deleted_at,
        );

        return !account || (account.is_active && !isAccountSuspended(account));
      })
      .map(({ organization }) => ({ organization }));
  }, [accounts, allOrganizations, organizers, currentUser]);

  const userOrganizationIds = useMemo(
    () => new Set(userOrganizations.map(({ organization }) => organization.id)),
    [userOrganizations],
  );
  const userOrganizationIdList = useMemo(
    () => userOrganizations.map(({ organization }) => organization.id),
    [userOrganizations],
  );

  const manageableOrganizations = useMemo(
    () =>
      userOrganizations
        .map(({ organization }) => organization)
        .filter(
          (organization) => organization.is_active && organization.is_verified,
        ),
    [userOrganizations],
  );

  const organizationById = useMemo(
    () =>
      new Map(
        userOrganizations.map(({ organization }) => [organization.id, organization]),
      ),
    [userOrganizations],
  );

  const userEvents = useMemo(
    () =>
      events
        .filter(
          (event) =>
            userOrganizationIds.has(event.organization_id) && !event.deleted_at,
        )
        .toSorted(
          (firstEvent, secondEvent) =>
            new Date(secondEvent.created_at ?? secondEvent.start_date).getTime() -
            new Date(firstEvent.created_at ?? firstEvent.start_date).getTime(),
        ),
    [events, userOrganizationIds],
  );

  useEffect(() => {
    if (userOrganizationIdList.length === 0) return;

    let ignore = false;

    const refreshOrganizationEvents = async () => {
      const results = await Promise.allSettled(
        userOrganizationIdList.map((organizationId) =>
          eventsApi.listManagedByOrganization(organizationId),
        ),
      );

      if (ignore) return;

      upsertEvents(
        results.flatMap((result) =>
          result.status === "fulfilled" && result.value.ok
            ? result.value.data
            : [],
        ),
      );
    };

    void refreshOrganizationEvents().catch(() => {});

    const refreshOnFocus = () => {
      void refreshOrganizationEvents().catch(() => {});
    };

    window.addEventListener("focus", refreshOnFocus);

    return () => {
      ignore = true;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [upsertEvents, userOrganizationIdList]);

  const closeEventModal = () => {
    setEditingEventId(null);
    setEventOrganizationId(null);
    setEventForm(null);
    setEventErrors({});
    setModalError(null);
  };

  const startEventCreate = () => {
    setEditingEventId(null);
    setEventOrganizationId(null);
    setEventForm(emptyEventForm());
    setEventErrors({});
    setModalError(null);
  };

  const startEventEdit = (event: Event) => {
    setEditingEventId(event.id);
    setEventOrganizationId(event.organization_id);
    setEventForm(toEventForm(event));
    setEventErrors({});
    setModalError(null);
  };

  const updateEventField = <Key extends keyof EventForm>(
    field: Key,
    value: EventForm[Key],
  ) => {
    setEventForm((currentForm) =>
      currentForm ? { ...currentForm, [field]: value } : currentForm,
    );
    setEventErrors((currentErrors) => ({
      ...currentErrors,
      [field]: undefined,
    }));
  };

  const toggleEventCategory = (category: EventCategory) => {
    if (!eventForm) return;

    updateEventField(
      "categories",
      eventForm.categories.includes(category)
        ? eventForm.categories.filter((item) => item !== category)
        : [...eventForm.categories, category],
    );
  };

  const saveEvent = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();

    if (!eventForm || isSavingEvent) return;

    if (eventOrganizationId === null) {
      setModalError("Sélectionnez une organisation pour cet événement");
      return;
    }

    const organization = allOrganizations.find(
      (item) => item.id === eventOrganizationId && !item.deleted_at,
    );

    if (!organization) {
      setModalError("Organisation introuvable");
      return;
    }

    if (!organization.is_active || !organization.is_verified) {
      setModalError(
        "Cette organisation doit être active et validée pour gérer ses événements",
      );
      return;
    }

    const errors = validateEventForm(eventForm);
    setEventErrors(errors);
    setModalError(null);

    if (Object.keys(errors).length > 0) return;

    const eventPayload = {
      organization_id: eventOrganizationId,
      title: eventForm.title.trim(),
      description: eventForm.description.trim(),
      start_date: toEventDateTimePayload(eventForm.start_date),
      end_date: toEventDateTimePayload(eventForm.end_date),
      address: eventForm.address.trim(),
      city: eventForm.city.trim(),
      postal_code: eventForm.postal_code.trim(),
      category_slugs: eventForm.categories,
      image: eventForm.image.trim(),
      price: Number(eventForm.price.trim()),
      ticketing_link: eventForm.ticketing_link.trim(),
      source: eventForm.source.trim() || "Événement créé par une organisation",
      is_active: false,
    };

    setIsSavingEvent(true);

    if (editingEventId === null) {
      const result = await eventsApi.create(eventPayload);

      if (!result.ok) {
        setIsSavingEvent(false);
        setModalError(result.error.message);
        return;
      }

      const persistedResult = await eventsApi.listManagedByOrganization(
        eventOrganizationId,
      );
      setIsSavingEvent(false);

      if (
        !persistedResult.ok ||
        !persistedResult.data.some((event) => event.id === result.data.id)
      ) {
        setModalError(
          "L'événement a été envoyé, mais il n'a pas pu être confirmé en base. Rechargez la page ou réessayez.",
        );
        return;
      }

      upsertEvents(persistedResult.data);
      toast.success("Événement envoyé en attente de publication");
    } else {
      const result = await eventsApi.update(editingEventId, eventPayload);
      setIsSavingEvent(false);

      if (!result.ok) {
        setModalError(result.error.message);
        return;
      }

      updateEvent(editingEventId, result.data);
      toast.success("Événement mis à jour, en attente de publication");
    }

    closeEventModal();
  };

  const confirmDeleteEvent = async () => {
    if (pendingDeleteEventId === null) return;

    const deletedEvent = events.find((event) => event.id === pendingDeleteEventId);

    const result = await eventsApi.remove(pendingDeleteEventId);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    deleteEvent(pendingDeleteEventId);
    setPendingDeleteEventId(null);
    closeEventModal();
    toast.success(`${deletedEvent?.title ?? "Événement"} supprimé`);
  };

  const pendingDeleteEvent = events.find(
    (event) => event.id === pendingDeleteEventId,
  );

  const emptyFeedbackMessage =
    manageableOrganizations.length === 0
      ? "Vous n'avez aucune organisation active et validée pour créer un événement."
      : userEvents.length === 0
        ? "Vous n'avez encore créé aucun événement."
        : null;

  return (
    <section className="user-organizations" aria-labelledby="user-orgs-title">
      <ConfirmDialog
        confirmLabel="Supprimer"
        message={
          pendingDeleteEvent
            ? `Supprimer l'événement "${pendingDeleteEvent.title}" ?`
            : "Supprimer cet événement ?"
        }
        open={pendingDeleteEventId !== null}
        title="Supprimer l'événement"
        onCancel={() => setPendingDeleteEventId(null)}
        onConfirm={confirmDeleteEvent}
      />

      <FormModal
        ariaLabel={
          editingEventId === null ? "Ajouter un événement" : "Modifier un événement"
        }
        open={eventForm !== null}
        size="lg"
        onClose={closeEventModal}
      >
        {eventForm && (
          <EventEditor
            errors={eventErrors}
            form={eventForm}
            organizationId={eventOrganizationId}
            organizationOptions={manageableOrganizations}
            modalError={modalError}
            showOrganizationSelect={editingEventId === null}
            isSaving={isSavingEvent}
            onCancel={closeEventModal}
            onCategoryToggle={toggleEventCategory}
            onFieldChange={updateEventField}
            onOrganizationChange={setEventOrganizationId}
            onSubmit={saveEvent}
          />
        )}
      </FormModal>

      {emptyFeedbackMessage ? (
        <div className="feedback-message feedback-message--empty">
          {emptyFeedbackMessage}
        </div>
      ) : (
        <div className="user-organization-event-list">
          {userEvents.map((event) => {
            const organization = organizationById.get(event.organization_id);
            const canManageEvents =
              !!organization?.is_active && !!organization.is_verified;
            const eventStatus = getEventStatus(event);
            const canManageEvent = canManageEvents && eventStatus.variant !== "pending";
            const ticketingHref = getTicketingHref(event.ticketing_link);

            return (
              <article className="user-organization-event" key={event.id}>
                <img src={event.image} alt="" loading="lazy" />
                <div>
                  <div className="user-organization-event__header">
                    <h5>{event.title}</h5>
                    <StatusBadge variant={eventStatus.variant}>
                      {eventStatus.label}
                    </StatusBadge>
                  </div>
                  <p>{event.description}</p>
                  <dl>
                    <div>
                      <dt>Dates</dt>
                      <dd>{formatEventDateRange(event)}</dd>
                    </div>
                    <div>
                      <dt>Lieu</dt>
                      <dd>
                        {event.address}, {event.city} {event.postal_code}
                      </dd>
                    </div>
                    <div>
                      <dt>Prix</dt>
                      <dd>{formatEventPrice(event.price)}</dd>
                    </div>
                    {ticketingHref && (
                      <div>
                        <dt>Billetterie</dt>
                        <dd>
                          <a
                            href={ticketingHref}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Ouvrir la billetterie
                          </a>
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Creation</dt>
                      <dd>
                        {event.created_at
                          ? formatDateTime(event.created_at)
                          : "Non renseignée"}
                      </dd>
                    </div>
                  </dl>
                  {canManageEvent && (
                    <ActionRow className="admin-actions">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => startEventEdit(event)}
                      >
                        Modifier
                      </Button>
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() => setPendingDeleteEventId(event.id)}
                      >
                        Supprimer
                      </Button>
                    </ActionRow>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <ActionRow className="user-organizations__actions" align="center">
        {manageableOrganizations.length > 0 && (
          <Button type="button" className="btn--primary" onClick={startEventCreate}>
            Ajouter un nouvel événement
          </Button>
        )}
      </ActionRow>
    </section>
  );
}

function EventEditor({
  errors,
  form,
  modalError,
  isSaving,
  organizationId,
  organizationOptions,
  showOrganizationSelect,
  onCancel,
  onCategoryToggle,
  onFieldChange,
  onOrganizationChange,
  onSubmit,
}: {
  errors: EventFormErrors;
  form: EventForm;
  modalError: string | null;
  isSaving: boolean;
  organizationId: number | null;
  organizationOptions: Organization[];
  showOrganizationSelect: boolean;
  onCancel: () => void;
  onCategoryToggle: (category: EventCategory) => void;
  onFieldChange: <Key extends keyof EventForm>(
    field: Key,
    value: EventForm[Key],
  ) => void;
  onOrganizationChange: (organizationId: number | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="admin-create-account" onSubmit={onSubmit} noValidate>
      <div className="admin-form-grid">
        {showOrganizationSelect && (
          <FormField
            label="Organization"
            htmlFor="member-event-organization"
            className="admin-form-grid__wide"
          >
            <Select
              id="member-event-organization"
              value={organizationId ?? ""}
              disabled={organizationOptions.length === 0}
              onChange={(event) =>
                onOrganizationChange(
                  event.target.value ? Number(event.target.value) : null,
                )
              }
            >
              <option value="">Sélectionner une organisation</option>
              {organizationOptions.map((organization) => (
                <option value={organization.id} key={organization.id}>
                  {organization.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Titre" htmlFor="member-event-title" error={errors.title}>
          <Input
            id="member-event-title"
            value={form.title}
            hasError={!!errors.title}
            onChange={(event) => onFieldChange("title", event.target.value)}
          />
        </FormField>
        <div className="admin-form-grid__wide">
          <CategorySelect
            error={errors.categories}
            labelId="member-event-categories"
            selected={form.categories}
            onToggle={onCategoryToggle}
          />
        </div>
        <FormField
          label="Description"
          htmlFor="member-event-description"
          className="admin-form-grid__wide"
          error={errors.description}
        >
          <Textarea
            id="member-event-description"
            rows={4}
            value={form.description}
            hasError={!!errors.description}
            onChange={(event) =>
              onFieldChange("description", event.target.value)
            }
          />
        </FormField>
        <FormField
          label="Date de début"
          htmlFor="member-event-start"
          error={errors.start_date}
        >
          <Input
            id="member-event-start"
            type="datetime-local"
            value={form.start_date}
            hasError={!!errors.start_date}
            onChange={(event) => onFieldChange("start_date", event.target.value)}
          />
        </FormField>
        <FormField
          label="Date de fin"
          htmlFor="member-event-end"
          error={errors.end_date}
        >
          <Input
            id="member-event-end"
            type="datetime-local"
            value={form.end_date}
            hasError={!!errors.end_date}
            onChange={(event) => onFieldChange("end_date", event.target.value)}
          />
        </FormField>
        <AddressAutocomplete
          addressClassName="admin-form-grid__wide"
          errors={{
            address: errors.address,
            city: errors.city,
            postal_code: errors.postal_code,
          }}
          ids={{
            address: "member-event-address",
            city: "member-event-city",
            postalCode: "member-event-postal-code",
          }}
          value={{
            address: form.address,
            city: form.city,
            postal_code: form.postal_code,
          }}
          onChange={onFieldChange}
        />
        <ImageField
          className="admin-form-grid__wide"
          id="member-event-image"
          value={form.image}
          error={errors.image}
          onChange={(value) => onFieldChange("image", value)}
        />
        <FormField label="Prix" htmlFor="member-event-price" error={errors.price}>
          <Input
            id="member-event-price"
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            hasError={!!errors.price}
            onChange={(event) => onFieldChange("price", event.target.value)}
          />
        </FormField>
        <FormField
          label="Lien de billetterie"
          htmlFor="member-event-ticketing-link"
          error={errors.ticketing_link}
        >
          <Input
            id="member-event-ticketing-link"
            type="url"
            value={form.ticketing_link}
            hasError={!!errors.ticketing_link}
            onChange={(event) =>
              onFieldChange("ticketing_link", event.target.value)
            }
          />
        </FormField>
        <FormField label="Source" htmlFor="member-event-source">
          <Input
            id="member-event-source"
            value={form.source}
            onChange={(event) => onFieldChange("source", event.target.value)}
          />
        </FormField>
      </div>

      {modalError && <ErrorMessage message={modalError} />}

      <ActionRow className="admin-actions">
        <Button type="submit" loading={isSaving} loadingLabel="Enregistrement...">
          Valider
        </Button>
        <Button variant="secondary" type="button" onClick={onCancel}>
          Annuler
        </Button>
      </ActionRow>
    </form>
  );
}
