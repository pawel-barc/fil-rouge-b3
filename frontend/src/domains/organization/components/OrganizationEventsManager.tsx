import { useState } from "react";
import { toast } from "react-toastify";

import CategorySelect from "../../event/components/CategorySelect";
import { eventsApi } from "../../event/api/events.api";
import EmptyState from "../../../shared/components/feedback/EmptyState";
import AddressAutocomplete from "../../../shared/components/forms/AddressAutocomplete";
import ConfirmDialog from "../../../shared/components/forms/ConfirmDialog";
import FormModal from "../../../shared/components/forms/FormModal";
import { FormModalLink } from "../../../shared/components/forms/FormModalLink";
import ImageField from "../../../shared/components/forms/ImageField";
import ActionRow from "../../../shared/components/layout/ActionRow";
import Toolbar from "../../../shared/components/layout/Toolbar";
import Button from "../../../shared/components/ui/Button";
import FormField from "../../../shared/components/ui/FormField";
import Input from "../../../shared/components/ui/Input";
import Select from "../../../shared/components/ui/Select";
import StatusBadge from "../../../shared/components/ui/StatusBadge";
import Textarea from "../../../shared/components/ui/Textarea";
import useAuthStore from "../../auth/store/authStore";
import type { EventCategory } from "../../event/types/event-categories";
import type { Event } from "../../event/types/event";
import useDataStore from "../../../shared/store/dataStore";
import { ROUTES } from "../../../shared/constants/routes";
import { useOrganizationAccess } from "../hooks/useOrganizationAccess";
import {
  formatEventPrice,
  formatDateTime,
  formatEventDateRange,
  getTicketingHref,
  toEventDateTimePayload,
  toDateTimeLocalValue,
} from "../../event/utils/event";
import { validateEventForm } from "../utils/organizationWorkflow";

type EventSort =
  | "created-desc"
  | "date-asc"
  | "date-desc"
  | "title-asc"
  | "city-asc";

type EventDraft = Omit<
  Event,
  | "id"
  | "latitude"
  | "longitude"
  | "organization_id"
  | "postal_code"
  | "price"
  | "ticketing_link"
  | "created_at"
  | "updated_at"
  | "category_slugs"
> & {
  postal_code: string;
  price: string;
  ticketing_link: string;
  category_slugs: EventCategory[];
};

const toEventDraft = (event: Event): EventDraft => ({
  title: event.title,
  description: event.description,
  start_date: toDateTimeLocalValue(event.start_date),
  end_date: toDateTimeLocalValue(event.end_date),
  address: event.address,
  city: event.city,
  postal_code: event.postal_code,
  category_slugs: event.category_slugs,
  image: event.image,
  price: event.price.toString(),
  ticketing_link: event.ticketing_link,
  source:
    event.source === "organization" || event.source === "Organization"
      ? "Événement créé par une organisation"
      : event.source ?? "",
  is_active: event.is_active,
});

const getEventCategories = (event: Event) => event.category_slugs;

const toggleDraftCategory = (
  draft: EventDraft,
  category: EventCategory,
): EventDraft => {
  const currentCategories = draft.category_slugs;
  const nextCategories = currentCategories.includes(category)
    ? currentCategories.filter((item) => item !== category)
    : [...currentCategories, category];

  return {
    ...draft,
    category_slugs: nextCategories,
  };
};

export default function OrganizationEvents() {
  const { isPendingApproval } = useOrganizationAccess();
  const currentUser = useAuthStore((s) => s.currentUser);
  const events = useDataStore((s) => s.events);
  const updateEvent = useDataStore((s) => s.updateEvent);
  const deleteEventFromStore = useDataStore((s) => s.deleteEvent);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [eventSearch, setEventSearch] = useState("");
  const [eventCityFilter, setEventCityFilter] = useState("all");
  const [eventSort, setEventSort] = useState<EventSort>("created-desc");
  const [pendingDeleteEventId, setPendingDeleteEventId] = useState<number | null>(
    null,
  );
  const [isSavingEvent, setIsSavingEvent] = useState(false);

  const organizationEvents = events.filter(
    (event) =>
      event.organization_id === currentUser?.organization_id && !event.deleted_at,
  );
  const organizationCities = Array.from(
    new Set(organizationEvents.map((event) => event.city.trim()).filter(Boolean)),
  ).sort((firstCity, secondCity) =>
    firstCity.localeCompare(secondCity, "fr-FR"),
  );
  const filteredOrganizationEvents = organizationEvents
    .filter((event) => {
      const normalizedSearch = eventSearch.trim().toLowerCase();
      const matchesSearch = [
        event.title,
        event.description,
        event.address,
        event.city,
        event.postal_code,
        formatEventPrice(event.price),
        event.ticketing_link,
        getEventCategories(event).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
      const matchesCity =
        eventCityFilter === "all" || event.city === eventCityFilter;

      return matchesSearch && matchesCity;
    })
    .sort((firstEvent, secondEvent) => {
      if (eventSort === "created-desc") {
        return (
          new Date(secondEvent.created_at ?? 0).getTime() -
          new Date(firstEvent.created_at ?? 0).getTime()
        );
      }

      if (eventSort === "date-desc") {
        return (
          new Date(secondEvent.start_date).getTime() -
          new Date(firstEvent.start_date).getTime()
        );
      }

      if (eventSort === "title-asc") {
        return firstEvent.title.localeCompare(secondEvent.title, "fr-FR");
      }

      if (eventSort === "city-asc") {
        return firstEvent.city.localeCompare(secondEvent.city, "fr-FR");
      }

      return (
        new Date(firstEvent.start_date).getTime() -
        new Date(secondEvent.start_date).getTime()
      );
    });

  const startEdit = (event: Event) => {
    setEditingEventId(event.id);
    setEventDraft(toEventDraft(event));
  };

  const cancelEdit = () => {
    setEditingEventId(null);
    setEventDraft(null);
  };

  const saveEvent = async () => {
    if (!editingEventId || !eventDraft || !currentUser?.organization_id) return;
    const originalEvent = organizationEvents.find(
      (event) => event.id === editingEventId,
    );

    if (!originalEvent) return;

    const eventErrors = validateEventForm({
      ...eventDraft,
      categories: eventDraft.category_slugs,
      source: eventDraft.source ?? "",
    });
    const firstError = Object.values(eventErrors)[0];

    if (firstError) {
      toast.error(firstError);
      return;
    }
    setIsSavingEvent(true);

    const nextEvent: Event = {
      ...originalEvent,
      title: eventDraft.title.trim(),
      description: eventDraft.description.trim(),
      start_date: toEventDateTimePayload(eventDraft.start_date),
      end_date: toEventDateTimePayload(eventDraft.end_date),
      address: eventDraft.address.trim(),
      city: eventDraft.city.trim(),
      postal_code: eventDraft.postal_code.trim(),
      category_slugs: eventDraft.category_slugs,
      image: eventDraft.image.trim(),
      price: Number(eventDraft.price.trim()),
      ticketing_link: eventDraft.ticketing_link.trim(),
      source: eventDraft.source?.trim() || "Événement créé par une organisation",
      organization_id: currentUser.organization_id,
      is_active: false,
    };

    const result = await eventsApi.update(editingEventId, nextEvent);

    if (!result.ok) {
      toast.error(result.error.message);
      setIsSavingEvent(false);
      return;
    }

    updateEvent(editingEventId, {
      ...result.data,
      organization_id: currentUser.organization_id,
    });

    cancelEdit();
    setIsSavingEvent(false);
    toast.success("Événement mis à jour, en attente de publication");
  };

  const deleteEvent = async (eventId: number) => {
    const deletedEvent = organizationEvents.find((event) => event.id === eventId);
    if (!deletedEvent) return;

    const result = await eventsApi.remove(eventId);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    deleteEventFromStore(eventId);
    setPendingDeleteEventId(null);
    cancelEdit();
    toast.success(`${deletedEvent.title} supprimé`);
  };

  const pendingDeleteEvent = organizationEvents.find(
    (event) => event.id === pendingDeleteEventId,
  );

  if (isPendingApproval) {
    return (
      <div className="organization-dashboard">
        <h2>Votre compte est en attente de validation</h2>
        <p>
          Votre compte doit être validé par un administrateur avant de pouvoir
          gérer des événements.
        </p>
      </div>
    );
  }

  return (
    <div className="organization-dashboard">
      <ConfirmDialog
        confirmLabel="Supprimer"
        message={
          pendingDeleteEvent
            ? `Supprimer l'événement "${pendingDeleteEvent.title}" ? Cette action le retirera de votre liste.`
            : "Supprimer cet événement ?"
        }
        open={pendingDeleteEventId !== null}
        title="Supprimer l'événement"
        onCancel={() => setPendingDeleteEventId(null)}
        onConfirm={() => {
          if (pendingDeleteEventId !== null) {
            void deleteEvent(pendingDeleteEventId);
          }
        }}
      />

      <FormModal
        ariaLabel="Modifier un événement"
        open={!!eventDraft && editingEventId !== null}
        size="lg"
        onClose={cancelEdit}
      >
        {eventDraft && (
          <OrganizationEventEditor
            draft={eventDraft}
            isSaving={isSavingEvent}
            setDraft={setEventDraft}
            onCancel={cancelEdit}
            onSave={() => void saveEvent()}
          />
        )}
      </FormModal>

      <section className="organization-dashboard__header">
        <h2>Mes événements</h2>
        <p>Consultez, modifiez ou supprimez les événements de votre organisation.</p>
      </section>

      <section className="organization-events" aria-labelledby="organization-events-title">
        <h2 id="organization-events-title">Liste des événements</h2>

        <Toolbar
          ariaLabel="Filtres des événements de l'organisation"
          className="admin-toolbar"
        >
          <label>
            Rechercher
            <Input
              value={eventSearch}
              placeholder="Titre, ville, code postal..."
              onChange={(event) => setEventSearch(event.target.value)}
            />
          </label>
          <label>
            Ville
            <Select
              value={eventCityFilter}
              onChange={(event) => setEventCityFilter(event.target.value)}
            >
              <option value="all">Toutes les villes</option>
              {organizationCities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Trier par
            <Select
              value={eventSort}
              onChange={(event) => setEventSort(event.target.value as EventSort)}
            >
              <option value="created-desc">Date de création</option>
              <option value="date-asc">Début croissant</option>
              <option value="date-desc">Début décroissant</option>
              <option value="title-asc">Titre A-Z</option>
              <option value="city-asc">Ville A-Z</option>
            </Select>
          </label>
        </Toolbar>

        {organizationEvents.length === 0 ? (
          <EmptyState message="Aucun événement créé pour le moment." />
        ) : filteredOrganizationEvents.length === 0 ? (
          <EmptyState message="Aucun événement ne correspond àux filtres." />
        ) : (
          <div className="organization-review-list">
            {filteredOrganizationEvents.map((event) => {
              const ticketingHref = getTicketingHref(event.ticketing_link);

              return (
              <article className="organization-review" key={event.id}>
                <StatusBadge
                  className="organization-review__status"
                  variant={event.is_active ? "active" : "pending"}
                >
                  {event.is_active ? "Publie" : "En attente"}
                </StatusBadge>
                <div className="organization-review__media">
                  <img src={event.image} alt={`Visuel ${event.title}`} />
                </div>

                <div className="organization-review__content">
                      <div className="organization-review__header">
                        <div>
                          <h3>{event.title}</h3>
                          <p>{event.description}</p>
                        </div>
                        <StatusBadge
                          variant={event.is_active ? "active" : "pending"}
                        >
                          {event.is_active ? "Publié" : "En attente"}
                        </StatusBadge>
                      </div>
                      <dl className="organization-review__details">
                        <div>
                          <dt>Horaires de l'événement</dt>
                          <dd>{formatEventDateRange(event)}</dd>
                        </div>
                        <div>
                          <dt>Coordonnées</dt>
                          <dd>
                            {event.latitude ?? "Non renseignée"},{" "}
                            {event.longitude ?? "Non renseignée"}
                          </dd>
                        </div>
                        <div>
                          <dt>Adresse</dt>
                          <dd>{event.address}</dd>
                        </div>
                        <div>
                          <dt>Ville</dt>
                          <dd>{event.city}</dd>
                        </div>
                        <div>
                          <dt>Code postal</dt>
                          <dd>{event.postal_code}</dd>
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
                          <dt>Date de création</dt>
                          <dd>
                            {event.created_at
                              ? formatDateTime(event.created_at)
                              : "Non renseignée"}
                          </dd>
                        </div>
                      </dl>
                      <div className="organization-review__footer">
                        <div className="organization-review__categories">
                          {getEventCategories(event).map((category) => (
                            <StatusBadge key={category}>
                              {category}
                            </StatusBadge>
                          ))}
                        </div>

                        <div className="admin-actions">
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => startEdit(event)}
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
                        </div>
                      </div>
                </div>
              </article>
              );
            })}
          </div>
        )}
        <FormModalLink className="btn btn--primary" to={ROUTES.ORGANIZATION.CREATE}>
          Ajouter un nouvel événement
        </FormModalLink>
      </section>
    </div>
  );
}

function OrganizationEventEditor({
  draft,
  isSaving,
  setDraft,
  onCancel,
  onSave,
}: {
  draft: EventDraft;
  isSaving: boolean;
  setDraft: (draft: EventDraft | null) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="admin-create-account">
      <h2>Modifier un événement</h2>
      <div className="admin-form-grid">
        <FormField label="Titre" htmlFor="organization-event-title">
          <Input
            id="organization-event-title"
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </FormField>

        <div className="admin-form-grid__wide">
          <CategorySelect
            labelId="organization-event-categories"
            selected={draft.category_slugs}
            onToggle={(category) => setDraft(toggleDraftCategory(draft, category))}
          />
        </div>

        <FormField
          label="Description"
          htmlFor="organization-event-description"
          className="admin-form-grid__wide"
        >
          <Textarea
            id="organization-event-description"
            rows={4}
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </FormField>

        <FormField label="Date de début" htmlFor="organization-event-start-date">
          <Input
            id="organization-event-start-date"
            type="datetime-local"
            value={draft.start_date}
            onChange={(event) =>
              setDraft({ ...draft, start_date: event.target.value })
            }
          />
        </FormField>

        <FormField label="Date de fin" htmlFor="organization-event-end-date">
          <Input
            id="organization-event-end-date"
            type="datetime-local"
            value={draft.end_date}
            onChange={(event) =>
              setDraft({ ...draft, end_date: event.target.value })
            }
          />
        </FormField>

        <AddressAutocomplete
          ids={{
            address: "organization-event-address",
            city: "organization-event-city",
            postalCode: "organization-event-postal-code",
          }}
          value={{
            address: draft.address,
            city: draft.city,
            postal_code: draft.postal_code,
          }}
          onChange={(field, fieldValue) =>
            setDraft({ ...draft, [field]: fieldValue })
          }
        />

        <ImageField
          className="admin-form-grid__wide"
          id="organization-event-image"
          value={draft.image}
          onChange={(value) => setDraft({ ...draft, image: value })}
        />

        <FormField label="Prix" htmlFor="organization-event-price">
          <Input
            id="organization-event-price"
            min="0"
            step="0.01"
            type="number"
            value={draft.price}
            onChange={(event) =>
              setDraft({ ...draft, price: event.target.value })
            }
          />
        </FormField>

        <FormField
          label="Lien de billetterie"
          htmlFor="organization-event-ticketing-link"
        >
          <Input
            id="organization-event-ticketing-link"
            type="url"
            value={draft.ticketing_link}
            onChange={(event) =>
              setDraft({ ...draft, ticketing_link: event.target.value })
            }
          />
        </FormField>

        <ActionRow className="admin-actions admin-form-grid__wide">
          <Button
            type="button"
            loading={isSaving}
            loadingLabel="Enregistrement..."
            onClick={onSave}
          >
            Valider
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Annuler
          </Button>
        </ActionRow>
      </div>
    </div>
  );
}
