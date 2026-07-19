import {
  createApiError,
  createApiSuccess,
  type ApiResult,
} from "../../../shared/api/api.types";
import { apiRequest } from "../../../shared/api/httpClient";
import { toBackendId } from "../../../shared/api/idMapping";
import { mediaApi } from "../../../shared/api/media.api";
import { isDataImageValue } from "../../../shared/utils/imageUpload";
import type { Organization } from "../../organization/types/organization";
import type { Favorite } from "../../user/types/favorite";
import type { History } from "../../user/types/history";
import type { Event } from "../types/event";
import type {
  EventCategoryName,
  EventCategoryOption,
} from "../types/event-categories";
import { normalizeEventDateTimes } from "../utils/event";

export const EVENTS_API_MODE = "http";

export const EVENTS_API_ENDPOINTS = {
  list: "/api/events",
  map: "/api/events/map",
  upcoming: "/api/events/upcoming",
  past: "/api/events/past",
  popular: "/api/events/popular",
  detail: (eventId: number) => `/api/events/${toBackendId(eventId)}`,
  create: "/api/events",
  imageUpload: "/api/events/images",
  update: (eventId: number) => `/api/events/${toBackendId(eventId)}`,
  delete: (eventId: number) => `/api/events/${toBackendId(eventId)}`,
  active: (eventId: number) => `/api/events/${toBackendId(eventId)}/active`,
  organizationEvents: (organizationId: number) =>
    `/api/organizations/${toBackendId(organizationId)}/events`,
  managedOrganizationEvents: (organizationId: number) =>
    `/api/me/organizations/${toBackendId(organizationId)}/events`,
  categories: "/api/event-categories",
  category: (categoryId: number) =>
    `/api/event-categories/${toBackendId(categoryId)}`,
  categoryEvents: (categoryId: number) =>
    `/api/event-categories/${toBackendId(categoryId)}/events`,
  eventCategories: (eventId: number) =>
    `/api/events/${toBackendId(eventId)}/categories`,
  eventCategory: (eventId: number, categoryId: number) =>
    `/api/events/${toBackendId(eventId)}/categories/${toBackendId(categoryId)}`,
  favorite: (eventId: number) => `/api/events/${toBackendId(eventId)}/favorite`,
  favorites: "/api/me/favorites",
  history: (eventId: number) => `/api/events/${toBackendId(eventId)}/history`,
  histories: "/api/me/history",
  historyEntry: (historyId: number) => `/api/me/history/${toBackendId(historyId)}`,
} as const;

export type EventSort =
  | "newest"
  | "oldest"
  | "created-asc"
  | "date-asc"
  | "date-desc"
  | "price-asc"
  | "price-desc"
  | "popular"
  | "popularity-desc";

export type EventListFilters = {
  q?: string;
  search?: string;
  city?: string;
  postalCode?: string;
  categories?: EventCategoryName[];
  organizationId?: number;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  priceMin?: number;
  priceMax?: number;
  free?: boolean;
  paid?: boolean;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  sort?: EventSort;
  limit?: number;
  offset?: number;
};

export type EventCreatePayload = Omit<
  Event,
  | "organization_id"
  | "id"
  | "time_start"
  | "time_end"
  | "latitude"
  | "longitude"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "organization"
> & {
  organization_id: number | null;
};

export type EventUpdatePayload = EventCreatePayload;

export type FavoriteState = {
  is_favorite: boolean;
};

const appendIfDefined = (
  params: URLSearchParams,
  key: string,
  value: string | number | boolean | undefined,
) => {
  if (value !== undefined && value !== "") {
    params.set(key, String(value));
  }
};

const getNormalizedEventImage = (event: Event) =>
  event.image_optimized_url?.trim() ||
  event.image?.trim() ||
  event.external_image_url?.trim() ||
  "";

const normalizeEventFromApi = (event: Event): Event => ({
  ...event,
  ...normalizeEventDateTimes(event),
  id: event.id,
  organization_id: event.organization_id ?? 0,
  image: getNormalizedEventImage(event),
  organization: event.organization
    ? {
        ...event.organization,
        id: event.organization.id,
      }
    : event.organization,
});

const normalizeEventsFromApi = (events: Event[]) => events.map(normalizeEventFromApi);

const toApiList = <Item>(items: Item[] | null | undefined): Item[] =>
  Array.isArray(items) ? items : [];

const normalizeFavoriteFromApi = (favorite: Favorite): Favorite => ({
  ...favorite,
  id: favorite.id,
  user_id: favorite.user_id,
  event_id: favorite.event_id,
  event: favorite.event ? normalizeEventFromApi(favorite.event) : favorite.event,
});

const normalizeHistoryFromApi = (history: History): History => ({
  ...history,
  id: history.id,
  user_id: history.user_id,
  event_id: history.event_id,
  event: history.event ? normalizeEventFromApi(history.event) : history.event,
});

const buildEventQuery = (filters: EventListFilters = {}) => {
  const params = new URLSearchParams();

  appendIfDefined(params, "q", filters.q ?? filters.search);
  appendIfDefined(params, "city", filters.city);
  appendIfDefined(params, "postal_code", filters.postalCode);
  appendIfDefined(
    params,
    "organization_id",
    filters.organizationId ? toBackendId(filters.organizationId) : undefined,
  );
  appendIfDefined(params, "date", filters.date);
  appendIfDefined(params, "date_from", filters.dateFrom);
  appendIfDefined(params, "date_to", filters.dateTo);
  appendIfDefined(params, "price_min", filters.priceMin);
  appendIfDefined(params, "price_max", filters.priceMax);
  appendIfDefined(params, "free", filters.free);
  appendIfDefined(params, "paid", filters.paid);
  appendIfDefined(params, "sort", filters.sort);
  appendIfDefined(params, "limit", filters.limit);
  appendIfDefined(params, "offset", filters.offset);

  if (filters.categories?.length) {
    params.set("categories", filters.categories.join(","));
  }
  if (filters.bounds) {
    appendIfDefined(params, "north", filters.bounds.north);
    appendIfDefined(params, "south", filters.bounds.south);
    appendIfDefined(params, "east", filters.bounds.east);
    appendIfDefined(params, "west", filters.bounds.west);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
};

const normalizePayload = async (
  payload: EventCreatePayload,
): Promise<ApiResult<EventCreatePayload>> => {
  const normalizedPayload: EventCreatePayload = {
    ...payload,
    organization_id: payload.organization_id
      ? toBackendId(payload.organization_id)
      : null,
    category_slugs: Array.from(new Set(payload.category_slugs)),
    image: payload.image.trim(),
    title: payload.title.trim(),
    description: payload.description.trim(),
    address: payload.address.trim(),
    city: payload.city.trim(),
    postal_code: payload.postal_code.trim(),
    ticketing_link: payload.ticketing_link.trim(),
    source: payload.source?.trim() || null,
    price: Number(payload.price),
  };

  if (!isDataImageValue(normalizedPayload.image)) {
    return createApiSuccess(normalizedPayload);
  }

  const uploadResult = await mediaApi.uploadImageValue(normalizedPayload.image, {
    entityType: "event",
    organizationId: normalizedPayload.organization_id ?? undefined,
  });
  if (!uploadResult.ok) {
    return createApiError(uploadResult.error.code, uploadResult.error.message);
  }

  return createApiSuccess({
    ...normalizedPayload,
    image: uploadResult.data.url,
  });
};

export const eventsApi = {
  async list(filters?: EventListFilters): Promise<ApiResult<Event[]>> {
    const result = await apiRequest<Event[] | null>(
      `${EVENTS_API_ENDPOINTS.list}${buildEventQuery(filters)}`,
    );
    return result.ok
      ? { ok: true, data: normalizeEventsFromApi(toApiList(result.data)) }
      : result;
  },

  async listMap(filters?: EventListFilters): Promise<ApiResult<Event[]>> {
    const result = await apiRequest<Event[] | null>(
      `${EVENTS_API_ENDPOINTS.map}${buildEventQuery(filters)}`,
    );
    return result.ok
      ? { ok: true, data: normalizeEventsFromApi(toApiList(result.data)) }
      : result;
  },

  async listUpcoming(filters?: EventListFilters): Promise<ApiResult<Event[]>> {
    const result = await apiRequest<Event[] | null>(
      `${EVENTS_API_ENDPOINTS.upcoming}${buildEventQuery(filters)}`,
    );
    return result.ok
      ? { ok: true, data: normalizeEventsFromApi(toApiList(result.data)) }
      : result;
  },

  async listPast(filters?: EventListFilters): Promise<ApiResult<Event[]>> {
    const result = await apiRequest<Event[] | null>(
      `${EVENTS_API_ENDPOINTS.past}${buildEventQuery(filters)}`,
    );
    return result.ok
      ? { ok: true, data: normalizeEventsFromApi(toApiList(result.data)) }
      : result;
  },

  async listPopular(filters?: EventListFilters): Promise<ApiResult<Event[]>> {
    const result = await apiRequest<Event[] | null>(
      `${EVENTS_API_ENDPOINTS.popular}${buildEventQuery(filters)}`,
    );
    return result.ok
      ? { ok: true, data: normalizeEventsFromApi(toApiList(result.data)) }
      : result;
  },

  async listByOrganization(
    organizationId: number,
    filters?: Omit<EventListFilters, "organizationId">,
  ): Promise<ApiResult<Event[]>> {
    const result = await apiRequest<Event[] | null>(
      `${EVENTS_API_ENDPOINTS.organizationEvents(organizationId)}${buildEventQuery(
        filters,
      )}`,
    );
    return result.ok
      ? { ok: true, data: normalizeEventsFromApi(toApiList(result.data)) }
      : result;
  },

  async listManagedByOrganization(
    organizationId: number,
    filters?: Omit<EventListFilters, "organizationId">,
  ): Promise<ApiResult<Event[]>> {
    const result = await apiRequest<Event[] | null>(
      `${EVENTS_API_ENDPOINTS.managedOrganizationEvents(
        organizationId,
      )}${buildEventQuery(filters)}`,
    );
    return result.ok
      ? { ok: true, data: normalizeEventsFromApi(toApiList(result.data)) }
      : result;
  },

  async get(eventId: number): Promise<ApiResult<Event>> {
    const result = await apiRequest<Event>(EVENTS_API_ENDPOINTS.detail(eventId));
    return result.ok ? { ok: true, data: normalizeEventFromApi(result.data) } : result;
  },

  async create(payload: EventCreatePayload): Promise<ApiResult<Event>> {
    const normalizedPayload = await normalizePayload(payload);
    if (!normalizedPayload.ok) return normalizedPayload;

    const result = await apiRequest<Event>(EVENTS_API_ENDPOINTS.create, {
      body: normalizedPayload.data,
      method: "POST",
    });
    return result.ok ? { ok: true, data: normalizeEventFromApi(result.data) } : result;
  },

  async update(
    eventId: number,
    payload: EventUpdatePayload,
  ): Promise<ApiResult<Event>> {
    const normalizedPayload = await normalizePayload(payload);
    if (!normalizedPayload.ok) return normalizedPayload;

    const result = await apiRequest<Event>(EVENTS_API_ENDPOINTS.update(eventId), {
      body: normalizedPayload.data,
      method: "PUT",
    });
    return result.ok ? { ok: true, data: normalizeEventFromApi(result.data) } : result;
  },

  remove(eventId: number): Promise<ApiResult<null>> {
    return apiRequest<null>(EVENTS_API_ENDPOINTS.delete(eventId), {
      method: "DELETE",
    });
  },

  async setActive(eventId: number, isActive: boolean): Promise<ApiResult<Event>> {
    const result = await apiRequest<Event>(EVENTS_API_ENDPOINTS.active(eventId), {
      body: { is_active: isActive },
      method: "PATCH",
    });
    return result.ok ? { ok: true, data: normalizeEventFromApi(result.data) } : result;
  },

  listCategories(): Promise<ApiResult<EventCategoryOption[]>> {
    return apiRequest<EventCategoryOption[]>(EVENTS_API_ENDPOINTS.categories);
  },

  getCategory(categoryId: number): Promise<ApiResult<EventCategoryOption>> {
    return apiRequest<EventCategoryOption>(EVENTS_API_ENDPOINTS.category(categoryId));
  },

  async listByCategory(
    categoryId: number,
    filters?: EventListFilters,
  ): Promise<ApiResult<Event[]>> {
    const result = await apiRequest<Event[] | null>(
      `${EVENTS_API_ENDPOINTS.categoryEvents(categoryId)}${buildEventQuery(filters)}`,
    );
    return result.ok
      ? { ok: true, data: normalizeEventsFromApi(toApiList(result.data)) }
      : result;
  },

  async replaceCategories(
    eventId: number,
    categorySlugs: EventCategoryName[],
  ): Promise<ApiResult<Event>> {
    const result = await apiRequest<Event>(EVENTS_API_ENDPOINTS.eventCategories(eventId), {
      body: { category_slugs: categorySlugs },
      method: "PUT",
    });
    return result.ok ? { ok: true, data: normalizeEventFromApi(result.data) } : result;
  },

  async addCategory(eventId: number, categoryId: number): Promise<ApiResult<Event>> {
    const result = await apiRequest<Event>(
      EVENTS_API_ENDPOINTS.eventCategory(eventId, categoryId),
      {
        method: "POST",
      },
    );
    return result.ok ? { ok: true, data: normalizeEventFromApi(result.data) } : result;
  },

  async removeCategory(eventId: number, categoryId: number): Promise<ApiResult<Event>> {
    const result = await apiRequest<Event>(
      EVENTS_API_ENDPOINTS.eventCategory(eventId, categoryId),
      {
        method: "DELETE",
      },
    );
    return result.ok ? { ok: true, data: normalizeEventFromApi(result.data) } : result;
  },

  async addFavorite(eventId: number): Promise<ApiResult<Favorite>> {
    const result = await apiRequest<Favorite>(EVENTS_API_ENDPOINTS.favorite(eventId), {
      method: "POST",
    });
    return result.ok ? { ok: true, data: normalizeFavoriteFromApi(result.data) } : result;
  },

  removeFavorite(eventId: number): Promise<ApiResult<null>> {
    return apiRequest<null>(EVENTS_API_ENDPOINTS.favorite(eventId), {
      method: "DELETE",
    });
  },

  isFavorite(eventId: number): Promise<ApiResult<FavoriteState>> {
    return apiRequest<FavoriteState>(EVENTS_API_ENDPOINTS.favorite(eventId));
  },

  async listFavorites(): Promise<ApiResult<Favorite[]>> {
    const result = await apiRequest<Favorite[] | null>(EVENTS_API_ENDPOINTS.favorites);
    return result.ok
      ? { ok: true, data: toApiList(result.data).map(normalizeFavoriteFromApi) }
      : result;
  },

  async recordHistory(eventId: number): Promise<ApiResult<History>> {
    const result = await apiRequest<History>(EVENTS_API_ENDPOINTS.history(eventId), {
      method: "POST",
    });
    return result.ok ? { ok: true, data: normalizeHistoryFromApi(result.data) } : result;
  },

  async listHistory(): Promise<ApiResult<History[]>> {
    const result = await apiRequest<History[] | null>(EVENTS_API_ENDPOINTS.histories);
    return result.ok
      ? { ok: true, data: toApiList(result.data).map(normalizeHistoryFromApi) }
      : result;
  },

  removeHistory(historyId: number): Promise<ApiResult<null>> {
    return apiRequest<null>(EVENTS_API_ENDPOINTS.historyEntry(historyId), {
      method: "DELETE",
    });
  },
};

export const isPublicEvent = (
  event: Event,
  organization?: Organization | null,
) =>
  !event.deleted_at &&
  event.is_active &&
  (organization ? organization.is_active && !organization.deleted_at : true);
