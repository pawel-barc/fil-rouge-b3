import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import EmptyState from "../../../shared/components/feedback/EmptyState";
import ConfirmDialog from "../../../shared/components/forms/ConfirmDialog";
import FormModal from "../../../shared/components/forms/FormModal";
import AddressAutocomplete from "../../../shared/components/forms/AddressAutocomplete";
import ImageField from "../../../shared/components/forms/ImageField";
import ActionRow from "../../../shared/components/layout/ActionRow";
import Button from "../../../shared/components/ui/Button";
import FormField from "../../../shared/components/ui/FormField";
import Input from "../../../shared/components/ui/Input";
import StatusBadge from "../../../shared/components/ui/StatusBadge";
import Textarea from "../../../shared/components/ui/Textarea";
import { ROUTES } from "../../../shared/constants/routes";
import useDataStore from "../../../shared/store/dataStore";
import useAuthStore from "../../auth/store/authStore";
import { eventsApi } from "../../event/api/events.api";
import CategorySelect from "../../event/components/CategorySelect";
import type { Event } from "../../event/types/event";
import type { EventCategory } from "../../event/types/event-categories";
import { organizationsApi } from "../api/organizations.api";
import {
  getOrganizationCategoryLabel,
  type OrganizationCategoryName,
} from "../types/organization-categories";
import {
  formatDateTime,
  formatEventDateRange,
  formatEventPrice,
  getTicketingHref,
  toEventDateTimePayload,
} from "../../event/utils/event";
import { OrganizationFields } from "./OrganizationSetupFlow";
import {
  emptyEventForm,
  getManagedEventStatus,
  getOrganizationStatus,
  toEventForm,
  toOrganizationForm,
  validateEventForm,
  validateOrganizationForm,
  type EventForm,
  type EventFormErrors,
  type OrganizationForm,
  type OrganizationFormErrors,
} from "../utils/organizationWorkflow";
import { getCurrentUserOrganizationMemberships } from "../utils/organizerAccess";

export default function OrganizationDetailPage() {
  const navigate = useNavigate();
  const { organizationId } = useParams();
  const currentUser = useAuthStore((s) => s.currentUser);
  const organizations = useDataStore((s) => s.organizations);
  const organizers = useDataStore((s) => s.organizers);
  const events = useDataStore((s) => s.events);
  const updateOrganization = useDataStore((s) => s.updateOrganization);
  const deleteOrganization = useDataStore((s) => s.deleteOrganization);
  const addEvent = useDataStore((s) => s.addEvent);
  const updateEvent = useDataStore((s) => s.updateEvent);
  const deleteEvent = useDataStore((s) => s.deleteEvent);
  const parsedOrganizationId = Number(organizationId);
  const membership = getCurrentUserOrganizationMemberships(
    currentUser,
    organizers,
    organizations,
  ).find(
    ({ organization }) => organization.id === parsedOrganizationId,
  );
  const organizerLink = membership?.organizer;
  const organization = membership?.organization;
  const organizationEvents = events
    .filter((event) => event.organization_id === parsedOrganizationId)
    .toSorted(
      (firstEvent, secondEvent) =>
        new Date(secondEvent.created_at ?? secondEvent.start_date).getTime() -
        new Date(firstEvent.created_at ?? firstEvent.start_date).getTime(),
    );
  const organizationStatus = organization ? getOrganizationStatus(organization) : null;
  const [organizationForm, setOrganizationForm] = useState<OrganizationForm | null>(
    null,
  );
  const [organizationErrors, setOrganizationErrors] =
    useState<OrganizationFormErrors>({});
  const [eventForm, setEventForm] = useState<EventForm | null>(null);
  const [eventErrors, setEventErrors] = useState<EventFormErrors>({});
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [pendingDeleteOrganization, setPendingDeleteOrganization] = useState(false);
  const [pendingDeleteEventId, setPendingDeleteEventId] = useState<number | null>(
    null,
  );
  const [modalError, setModalError] = useState<string | null>(null);

  const closeOrganizationEditor = () => {
    setOrganizationForm(null);
    setOrganizationErrors({});
    setModalError(null);
  };

  const closeEventEditor = () => {
    setEventForm(null);
    setEventErrors({});
    setEditingEventId(null);
    setModalError(null);
  };

  const updateOrganizationField = <Key extends keyof OrganizationForm>(
    field: Key,
    value: OrganizationForm[Key],
  ) => {
    setOrganizationForm((currentForm) =>
      currentForm ? { ...currentForm, [field]: value } : currentForm,
    );
    setOrganizationErrors((currentErrors) => ({
      ...currentErrors,
      [field]: undefined,
    }));
    setModalError(null);
  };

  const toggleOrganizationCategory = (
    category: OrganizationForm["categories"][number],
  ) => {
    if (!organizationForm) return;

    updateOrganizationField(
      "categories",
      organizationForm.categories.includes(category)
        ? organizationForm.categories.filter((item) => item !== category)
        : [...organizationForm.categories, category],
    );
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
    setModalError(null);
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

  const startOrganizationEdit = () => {
    if (!organization) return;

    setOrganizationForm(toOrganizationForm(organization));
    setOrganizationErrors({});
    setModalError(null);
  };

  const saveOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!organization || !organizationForm) return;

    const errors = validateOrganizationForm(
      organizationForm,
      organizations,
      organization.id,
    );
    setOrganizationErrors(errors);
    setModalError(null);

    if (Object.keys(errors).length > 0) return;

    const payload = {
      name: organizationForm.name.trim(),
      contact_email: organizationForm.contact_email.trim(),
      description: organizationForm.description.trim(),
      website: organizationForm.website.trim() || null,
      address: organizationForm.address.trim(),
      city: organizationForm.city.trim(),
      postal_code: organizationForm.postal_code.trim(),
      logo: organizationForm.logo.trim() || null,
      contact_phone_number: organizationForm.contact_phone_number.trim() || null,
      siret: organizationForm.siret.trim() || null,
      category_slugs: organizationForm.categories,
    };

    const result = await organizationsApi.update(organization.id, payload);

    if (!result.ok) {
      setModalError(result.error.message);
      return;
    }

    updateOrganization(organization.id, result.data);
    closeOrganizationEditor();
    toast.success("Organisation mise à jour");
  };

  const confirmDeleteOrganization = async () => {
    if (!organization) return;

    const result = await organizationsApi.remove(organization.id);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    deleteOrganization(organization.id);
    setPendingDeleteOrganization(false);
    toast.success("Organisation supprimée");
    navigate(ROUTES.USER.ORGANIZATIONS, { replace: true });
  };

  const startEventCreate = () => {
    setEditingEventId(null);
    setEventForm(emptyEventForm());
    setEventErrors({});
    setModalError(null);
  };

  const startEventEdit = (event: Event) => {
    setEditingEventId(event.id);
    setEventForm(toEventForm(event));
    setEventErrors({});
    setModalError(null);
  };

  const saveEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!organization || !eventForm) return;

    const errors = validateEventForm(eventForm);
    setEventErrors(errors);
    setModalError(null);

    if (Object.keys(errors).length > 0) return;

    const eventPayload = {
      organization_id: organization.id,
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
      suspended_until: null,
      suspension_reason: null,
      deleted_at: null,
    };

    if (editingEventId === null) {
      const result = await eventsApi.create(eventPayload);

      if (!result.ok) {
        setModalError(result.error.message);
        return;
      }

      addEvent(result.data);
      toast.success("Événement créé en attente de validation");
    } else {
      const result = await eventsApi.update(editingEventId, eventPayload);

      if (!result.ok) {
        setModalError(result.error.message);
        return;
      }

      updateEvent(editingEventId, result.data);
      toast.success("Événement mis à jour en attente de validation");
    }

    closeEventEditor();
  };

  const confirmDeleteEvent = async () => {
    if (pendingDeleteEventId === null) return;

    const result = await eventsApi.remove(pendingDeleteEventId);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    deleteEvent(pendingDeleteEventId);
    setPendingDeleteEventId(null);
    closeEventEditor();
    toast.success("Événement supprimé");
  };

  const pendingDeleteEvent = events.find((event) => event.id === pendingDeleteEventId);

  if (!organization || !organizationStatus) {
    return (
      <section className="organization-detail">
        <ErrorMessage message="Organisation introuvable ou non rattachée à votre compte." />
        <Link className="btn btn--secondary" to={ROUTES.USER.ORGANIZATIONS}>
          Retour aux organisations
        </Link>
      </section>
    );
  }

  return (
    <section className="organization-detail">
      <ConfirmDialog
        confirmLabel="Supprimer"
        message={`Supprimer l'organisation "${organization.name}" et masquer ses événements ?`}
        open={pendingDeleteOrganization}
        title="Supprimer l'organisation"
        onCancel={() => setPendingDeleteOrganization(false)}
        onConfirm={() => {
          void confirmDeleteOrganization();
        }}
      />

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
        onConfirm={() => {
          void confirmDeleteEvent();
        }}
      />

      <FormModal
        ariaLabel="Modifier une organisation"
        open={organizationForm !== null}
        size="lg"
        onClose={closeOrganizationEditor}
      >
        {organizationForm && (
          <form className="organization-form" onSubmit={saveOrganization} noValidate>
            <h2>Modifier l'organisation</h2>
            <OrganizationFields
              errors={organizationErrors}
              form={organizationForm}
              onCategoryToggle={toggleOrganizationCategory}
              onFieldChange={updateOrganizationField}
            />
            {modalError && <ErrorMessage message={modalError} />}
            <ActionRow className="form-step-actions" align="center">
              <Button type="submit">Enregistrer</Button>
              <Button type="button" variant="secondary" onClick={closeOrganizationEditor}>
                Annuler
              </Button>
            </ActionRow>
          </form>
        )}
      </FormModal>

      <FormModal
        ariaLabel={editingEventId === null ? "Créer un événement" : "Modifier un événement"}
        open={eventForm !== null}
        size="lg"
        onClose={closeEventEditor}
      >
        {eventForm && (
          <EventEditor
            errors={eventErrors}
            form={eventForm}
            modalError={modalError}
            title={editingEventId === null ? "Créer un événement" : "Modifier un événement"}
            onCancel={closeEventEditor}
            onCategoryToggle={toggleEventCategory}
            onFieldChange={updateEventField}
            onSubmit={saveEvent}
          />
        )}
      </FormModal>

      <div className="organization-detail__back">
        <Link className="btn btn--secondary" to={ROUTES.USER.ORGANIZATIONS}>
          Retour aux organisations
        </Link>
      </div>

      <header className="organization-detail__header">
        <div className="organization-detail__logo">
          {organization.logo ? (
            <img src={organization.logo} alt={`Logo ${organization.name}`} />
          ) : (
            <span>{organization.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div>
          <div className="organization-detail__title">
            <h1>{organization.name}</h1>
            <StatusBadge variant={organizationStatus.variant}>
              {organizationStatus.label}
            </StatusBadge>
          </div>
          <p>{organization.description}</p>
          <ActionRow className="organization-detail__actions">
            <Button type="button" variant="secondary" onClick={startOrganizationEdit}>
              Modifier
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => setPendingDeleteOrganization(true)}
            >
              Supprimer
            </Button>
          </ActionRow>
        </div>
      </header>

      <section className="organization-detail__section">
        <h2>Informations</h2>
        <dl className="organization-detail__info">
          <div>
            <dt>Email</dt>
            <dd>{organization.contact_email}</dd>
          </div>
          <div>
            <dt>Catégories</dt>
            <dd>
              {organization.category_slugs
                .map((category) =>
                  getOrganizationCategoryLabel(category as OrganizationCategoryName),
                )
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt>Fonction</dt>
            <dd>{organizerLink?.job_role ?? "Organisateur"}</dd>
          </div>
          <div>
            <dt>Adresse</dt>
            <dd>
              {organization.address}, {organization.city} {organization.postal_code}
            </dd>
          </div>
          <div>
            <dt>Site web</dt>
            <dd>{organization.website || "Non renseigne"}</dd>
          </div>
          <div>
            <dt>Telephone</dt>
            <dd>{organization.contact_phone_number || "Non renseigne"}</dd>
          </div>
          <div>
            <dt>SIRET</dt>
            <dd>{organization.siret || "Non renseigne"}</dd>
          </div>
          <div>
            <dt>Coordonnées</dt>
            <dd>
              {organization.latitude ?? "Non renseignee"},{" "}
              {organization.longitude ?? "Non renseignee"}
            </dd>
          </div>
          <div>
            <dt>Creation</dt>
            <dd>{formatDateTime(organization.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="organization-detail__section organization-events-panel">
        <div className="organization-events-panel__header">
          <div>
            <h2>Événements</h2>
            <p>Création, modification et suppression des événements de cette organisation.</p>
          </div>
          <Button type="button" onClick={startEventCreate}>
            Créer un événement
          </Button>
        </div>

        {organizationEvents.length === 0 ? (
          <EmptyState message="Aucun événement rattaché à cette organisation." />
        ) : (
          <div className="organization-event-list">
            {organizationEvents.map((event) => {
              const status = getManagedEventStatus(event);
              const ticketingHref = getTicketingHref(event.ticketing_link);

              return (
                <article className="organization-event-card" key={event.id}>
                  <img src={event.image} alt="" loading="lazy" />
                  <div className="organization-event-card__body">
                    <div className="organization-event-card__header">
                      <h3>{event.title}</h3>
                      <StatusBadge variant={status.variant}>{status.label}</StatusBadge>
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
                        <dt>Categories</dt>
                        <dd>{event.category_slugs.join(", ")}</dd>
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
                    </dl>
                    <ActionRow className="admin-actions">
                      <Button
                        disabled={!!event.deleted_at}
                        type="button"
                        variant="secondary"
                        onClick={() => startEventEdit(event)}
                      >
                        Modifier
                      </Button>
                      <Button
                        disabled={!!event.deleted_at}
                        type="button"
                        variant="danger"
                        onClick={() => setPendingDeleteEventId(event.id)}
                      >
                        Supprimer
                      </Button>
                    </ActionRow>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function EventEditor({
  errors,
  form,
  modalError,
  title,
  onCancel,
  onCategoryToggle,
  onFieldChange,
  onSubmit,
}: {
  errors: EventFormErrors;
  form: EventForm;
  modalError: string | null;
  title: string;
  onCancel: () => void;
  onCategoryToggle: (category: EventCategory) => void;
  onFieldChange: <Key extends keyof EventForm>(
    field: Key,
    value: EventForm[Key],
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="organization-form" onSubmit={onSubmit} noValidate>
      <h2>{title}</h2>
      <div className="organization-form__grid">
        <FormField label="Titre" htmlFor="event-title" error={errors.title}>
          <Input
            id="event-title"
            hasError={!!errors.title}
            value={form.title}
            onChange={(event) => onFieldChange("title", event.target.value)}
          />
        </FormField>

        <div className="organization-form__wide">
          <CategorySelect
            error={errors.categories}
            labelId="event-categories"
            selected={form.categories}
            onToggle={onCategoryToggle}
          />
        </div>

        <FormField
          className="organization-form__wide"
          label="Description"
          htmlFor="event-description"
          error={errors.description}
        >
          <Textarea
            id="event-description"
            hasError={!!errors.description}
            rows={4}
            value={form.description}
            onChange={(event) => onFieldChange("description", event.target.value)}
          />
        </FormField>

        <FormField label="Date de debut" htmlFor="event-start" error={errors.start_date}>
          <Input
            id="event-start"
            hasError={!!errors.start_date}
            type="datetime-local"
            value={form.start_date}
            onChange={(event) => onFieldChange("start_date", event.target.value)}
          />
        </FormField>

        <FormField label="Date de fin" htmlFor="event-end" error={errors.end_date}>
          <Input
            id="event-end"
            hasError={!!errors.end_date}
            type="datetime-local"
            value={form.end_date}
            onChange={(event) => onFieldChange("end_date", event.target.value)}
          />
        </FormField>

        <AddressAutocomplete
          addressClassName="organization-form__wide"
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
          onChange={onFieldChange}
        />

        <ImageField
          className="organization-form__wide"
          id="event-image"
          value={form.image}
          error={errors.image}
          onChange={(value) => onFieldChange("image", value)}
        />

        <FormField label="Prix" htmlFor="event-price" error={errors.price}>
          <Input
            id="event-price"
            hasError={!!errors.price}
            min="0"
            step="0.01"
            type="number"
            value={form.price}
            onChange={(event) => onFieldChange("price", event.target.value)}
          />
        </FormField>

        <FormField
          label="Lien de billetterie"
          htmlFor="event-ticketing-link"
          error={errors.ticketing_link}
        >
          <Input
            id="event-ticketing-link"
            hasError={!!errors.ticketing_link}
            type="url"
            value={form.ticketing_link}
            onChange={(event) =>
              onFieldChange("ticketing_link", event.target.value)
            }
          />
        </FormField>

        <FormField label="Source" htmlFor="event-source">
          <Input
            id="event-source"
            value={form.source}
            onChange={(event) => onFieldChange("source", event.target.value)}
          />
        </FormField>
      </div>

      {modalError && <ErrorMessage message={modalError} />}

      <ActionRow className="form-step-actions" align="center">
        <Button type="submit">Enregistrer</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Annuler
        </Button>
      </ActionRow>
    </form>
  );
}
