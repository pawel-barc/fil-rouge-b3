import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MapPinned } from "lucide-react";

import { ROUTES } from "../../../shared/constants/routes";
import {
  formatDistance,
  formatEventDateRange,
  formatEventPrice,
  getEventThumbnailUrl,
  hasDisplayableEventImage,
} from "../../event/utils/event";
import type { Event } from "../../event/types/event";

type EventListingCardProps = {
  event: Event;
  actions?: ReactNode;
  meta?: ReactNode;
  distanceInKilometers?: number | null;
};

const getEventMapHref = (eventId: number) =>
  `${ROUTES.PUBLIC.HOME}?event=${eventId}`;

export default function EventListingCard({
  event,
  actions,
  meta,
  distanceInKilometers,
}: EventListingCardProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageUrl = getEventThumbnailUrl(event);
  const hasImageError = failedImageUrl === imageUrl;
  const distanceLabel =
    distanceInKilometers == null ? null : formatDistance(distanceInKilometers);

  if (!hasDisplayableEventImage(event) || hasImageError) {
    return null;
  }

  return (
    <article className="event-card" key={event.id}>
      <div className="event-card__image-frame event-image-skeleton">
        <img
          className="event-card__image"
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      </div>
      <div className="event-card__content">
        <div className="event-card__meta">
          <div className="event-card__tags" aria-label="Tags de l'événement">
            {event.category_slugs.map((tag) => (
              <div className={`event-card__tag event-card__tag--${tag}`} key={tag}>
                {tag}
              </div>
            ))}
          </div>
          {meta ?? (
            <time dateTime={event.start_date}>{formatEventDateRange(event)}</time>
          )}
        </div>

        <h3>{event.title}</h3>
        <p>{event.description}</p>

        <dl className="event-card__details">
          <div>
            <dt>Horaires</dt>
            <dd>{formatEventDateRange(event)}</dd>
          </div>
          <div>
            <dt>Ville</dt>
            <dd>
              {event.city}
              {distanceLabel ? ` - ${distanceLabel}` : ""}
            </dd>
          </div>
          <div>
            <dt>Prix</dt>
            <dd>{formatEventPrice(event.price)}</dd>
          </div>
        </dl>

        <div className="event-card__actions">
          <Link
            className="btn btn--secondary event-card__map-link btn__content"
            to={getEventMapHref(event.id)}
          >
            <MapPinned size={18} aria-hidden="true" />
            Afficher
          </Link>
          {actions}
        </div>
      </div>
    </article>
  );
}
