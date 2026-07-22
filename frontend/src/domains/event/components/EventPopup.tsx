import { Popup } from "react-leaflet";

import type { Event } from "../types/event-categories";
import FavoriteButton from "./FavoriteButton";
import ReportEventButton from "./ReportEventButton";
import WeatherBadge from "./WeatherBadge";
import {
  formatEventDateRange,
  formatEventPrice,
  getEventImageUrl,
  getTicketingHref,
} from "../utils/event";

type Props = {
  event: Event & { latitude: number; longitude: number };
  onImageError?: (eventId: number) => void;
};

export default function EventPopup({ event, onImageError }: Props) {
  const ticketingHref = getTicketingHref(event.ticketing_link);
  const imageUrl = getEventImageUrl(event);

  return (
    <Popup>
      <div className="event-popup">
        <div className="event-popup__image-frame event-image-skeleton">
          <img
            src={imageUrl}
            alt={event.title}
            className="event-popup__image"
            decoding="async"
            loading="lazy"
            onError={() => onImageError?.(event.id)}
          />
        </div>
        <FavoriteButton event={event} />
        <ReportEventButton event={event} />

        <WeatherBadge
          latitude={event.latitude}
          longitude={event.longitude}
          startDate={event.start_date}
        />

        <h3>{event.title}</h3>
        <p>
          <strong>Horaires de l'événement :</strong> {formatEventDateRange(event)}
        </p>
        <p>
          <strong>Lieu :</strong> {event.address}, {event.city}{" "}
          {event.postal_code}
        </p>
        <p>
          <strong>Prix :</strong> {formatEventPrice(event.price)}
        </p>
        <p>{event.description}</p>
        {ticketingHref && (
          <a
            className="btn btn--secondary"
            href={ticketingHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Billetterie
          </a>
        )}
        <a
          className="btn"
          href={`https://www.google.com/maps/dir/?api=1&destination=${event.latitude},${event.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Itineraire
        </a>
      </div>
    </Popup>
  );
}
