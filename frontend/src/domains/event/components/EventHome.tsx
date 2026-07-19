import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type TouchEvent,
} from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  MapPin,
  Navigation,
  Search,
  Share2,
  SlidersHorizontal,
  Ticket,
  UserRound,
  X,
} from "lucide-react";

import EmptyState from "../../../shared/components/feedback/EmptyState";
import FormModal from "../../../shared/components/forms/FormModal";
import HeaderWeather from "../../../shared/components/layout/HeaderWeather";
import Button from "../../../shared/components/ui/Button";
import Input from "../../../shared/components/ui/Input";
import Select from "../../../shared/components/ui/Select";
import { ROUTES } from "../../../shared/constants/routes";
import useAuthStore from "../../auth/store/authStore";
import NotificationBadge from "../../notification/components/NotificationBadge";
import useDataStore from "../../../shared/store/dataStore";
import {
  EVENT_CATEGORIES,
  getEventCategorySlug,
  type EventCategory,
  type EventCategoryName,
} from "../types/event-categories";
import EventMap from "../components/EventMap";
import FavoriteButton from "../components/FavoriteButton";
import ReportEventButton from "../components/ReportEventButton";
import WeatherBadge from "../components/WeatherBadge";
import useUserLocation from "../hooks/useUserLocation";
import { eventsApi } from "../api/events.api";
import {
  formatDistance,
  formatEventPrice,
  formatEventDateRange,
  getEventImageUrl,
  getEventThumbnailUrl,
  getTicketingHref,
  getDistanceInKilometers,
  getDefaultPeriodValue,
  getEventStatus,
  getPeriodRange,
  hasDisplayableEventImage,
  hasEventCoordinates,
  isEventSuspended,
  isEventInPeriod,
  type GeoPoint,
  type EventPeriodMode,
} from "../utils/event";
import type { Event } from "../types/event";

type SortValue =
  | "date-asc"
  | "date-desc"
  | "distance-asc"
  | "popularity-desc"
  | "title-asc"
  | "title-desc"
  | "city-asc"
  | "price-asc"
  | "price-desc";

type PriceFilter = "all" | "free" | "paid";
type MapEventSelection = {
  eventId: number;
  requestId: number;
};
type MobileSheetState = "preview" | "expanded";
type DesktopSidebarView = "list" | "filters";
type EventStatus = ReturnType<typeof getEventStatus>;
type EventSectionKey = EventStatus | "recommended" | "mobileRecommended";
type EventHomeProps = {
  isInitialDataReady?: boolean;
};

const HOME_VISIBLE_IMAGES_READY_EVENT = "mappening:home-visible-images-ready";
const DEFAULT_PERIOD_MODE: EventPeriodMode = "month";
const DEFAULT_SORT: SortValue = "date-asc";
const INITIAL_NEARBY_EVENTS_COUNT = 5;
const PROGRESSIVE_EVENT_BATCH_DELAY_MS = 140;
const PROGRESSIVE_EVENT_BATCH_SIZE = 10;
const createDefaultOpenEventSections = (): Record<EventSectionKey, boolean> => ({
  current: true,
  upcoming: true,
  past: false,
  recommended: true,
  mobileRecommended: true,
});

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const removeTrailingDescriptionEllipsis = (value: string) =>
  value.replace(/\s*(?:\.{3}|\u2026)\s*$/u, "");

const getEventCategories = (event: {
  category_slugs: EventCategory[];
}) => event.category_slugs;

const getPreferenceMatchCount = (
  event: { category_slugs: EventCategory[] },
  preferredCategorySet: Set<EventCategoryName>,
) =>
  getEventCategories(event).filter((eventCategory) =>
    preferredCategorySet.has(eventCategory),
  ).length;

const getEventsGridClassName = (eventsToDisplay: Event[]) =>
  `events-list__grid${
    eventsToDisplay.length === 1 ? " events-list__grid--single" : ""
  }`;

const sortEventsByDistanceToPoint = (
  eventsToSort: Event[],
  point: GeoPoint,
): Event[] =>
  eventsToSort
    .map((event) => ({
      distance:
        hasEventCoordinates(event)
          ? getDistanceInKilometers(point, event)
          : Number.POSITIVE_INFINITY,
      event,
    }))
    .sort((firstItem, secondItem) => {
      if (firstItem.distance !== secondItem.distance) {
        return firstItem.distance - secondItem.distance;
      }

      return (
        new Date(firstItem.event.start_date).getTime() -
        new Date(secondItem.event.start_date).getTime()
      );
    })
    .map((item) => item.event);

const statusSections: {
  status: EventStatus;
  title: string;
  empty: string;
}[] = [
  {
    status: "current",
    title: "Événements en cours",
    empty: "Aucun événement en cours.",
  },
  {
    status: "upcoming",
    title: "Les prochains événements",
    empty: "Aucun événement prochain ne correspond à votre recherche.",
  },
  {
    status: "past",
    title: "Événements passés",
    empty: "Aucun événement passé ne correspond à votre recherche.",
  },
];

export default function Home({ isInitialDataReady = true }: EventHomeProps) {
  const location = useLocation();
  const currentUser = useAuthStore((s) => s.currentUser);
  const isUserAccount = currentUser?.role === "user";
  const currentUserId = isUserAccount ? currentUser.user_id : undefined;
  const events = useDataStore((s) => s.events);
  const organizations = useDataStore((s) => s.organizations);
  const userEventPreferences = useDataStore((s) => s.userEventPreferences);
  const favorites = useDataStore((s) => s.favorites);
  const histories = useDataStore((s) => s.histories);
  const notifications = useDataStore((s) => s.notifications);
  const upsertHistory = useDataStore((s) => s.upsertHistory);
  const { position: userPosition, loading: isUserLocationLoading } =
    useUserLocation();
  const [search, setSearch] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(false);
  const [isDesktopSearchActive, setIsDesktopSearchActive] = useState(false);
  const [desktopSidebarView, setDesktopSidebarView] =
    useState<DesktopSidebarView>("list");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [mobileSheetState, setMobileSheetState] =
    useState<MobileSheetState>("preview");
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [city, setCity] = useState("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [sort, setSort] = useState<SortValue>(DEFAULT_SORT);
  const [openEventSections, setOpenEventSections] = useState(
    createDefaultOpenEventSections,
  );
  const [mapEventSelection, setMapEventSelection] =
    useState<MapEventSelection | null>(null);
  const mapSectionRef = useRef<HTMLElement | null>(null);
  const mobileSheetTouchStartY = useRef<number | null>(null);
  const [mapPeriodMode, setMapPeriodMode] =
    useState<EventPeriodMode>(DEFAULT_PERIOD_MODE);
  const [defaultMapPeriodValue] = useState(() =>
    getDefaultPeriodValue(DEFAULT_PERIOD_MODE),
  );
  const [mapPeriodValue, setMapPeriodValue] = useState(defaultMapPeriodValue);
  const desktopFloatingSearchInputRef = useRef<HTMLInputElement | null>(null);
  const desktopSidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusDesktopSidebarSearchRef = useRef(false);
  const sidebarViewportStateRef = useRef({
    isDesktopOpen: false,
    mobileSheetState: "preview" as MobileSheetState,
  });
  const [failedImageEventIds, setFailedImageEventIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [visibleNearbyEventCount, setVisibleNearbyEventCount] = useState(
    PROGRESSIVE_EVENT_BATCH_SIZE,
  );

  const markEventImageAsFailed = useCallback((eventId: number) => {
    setFailedImageEventIds((currentIds) => {
      if (currentIds.has(eventId)) return currentIds;

      const nextIds = new Set(currentIds);
      nextIds.add(eventId);
      return nextIds;
    });
    setSelectedEventId((currentEventId) =>
      currentEventId === eventId ? null : currentEventId,
    );
    setMapEventSelection((currentSelection) =>
      currentSelection?.eventId === eventId ? null : currentSelection,
    );
  }, []);

  const displayableEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          hasDisplayableEventImage(event) && !failedImageEventIds.has(event.id),
      ),
    [events, failedImageEventIds],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateMobileState = () => {
      const isMobileView = mediaQuery.matches;

      setIsMobile(isMobileView);
      if (isMobileView) {
        setMobileSheetState(
          sidebarViewportStateRef.current.isDesktopOpen ? "expanded" : "preview",
        );
      } else {
        setIsDesktopSidebarOpen(
          sidebarViewportStateRef.current.mobileSheetState !== "preview",
        );
      }
      if (!isMobileView) {
        setOpenEventSections((sections) => ({ ...sections, past: true }));
      }
    };

    updateMobileState();
    mediaQuery.addEventListener("change", updateMobileState);
    document.body.classList.add("events-home-route");

    return () => {
      mediaQuery.removeEventListener("change", updateMobileState);
      document.body.classList.remove("events-home-route");
    };
  }, []);

  useEffect(() => {
    sidebarViewportStateRef.current.isDesktopOpen = isDesktopSidebarOpen;
  }, [isDesktopSidebarOpen]);

  useEffect(() => {
    sidebarViewportStateRef.current.mobileSheetState = mobileSheetState;
  }, [mobileSheetState]);

  const activeOrganizationsById = useMemo(
    () => {
      const map = new Map<
        number,
        {
          id: number;
          name: string;
          is_active: boolean;
          latitude?: number | null;
          longitude?: number | null;
          deleted_at?: string | null;
        }
      >(
        organizations
          .filter((organization) => organization.is_active && !organization.deleted_at)
          .map((organization) => [organization.id, organization]),
      );

      events.forEach((event) => {
        if (event.organization?.is_active && !map.has(event.organization.id)) {
          map.set(event.organization.id, {
            id: event.organization.id,
            name: event.organization.name,
            is_active: event.organization.is_active,
            latitude: event.organization.latitude,
            longitude: event.organization.longitude,
          });
        }
      });

      return map;
    },
    [events, organizations],
  );
  const getEventCoordinates = useCallback(
    (event: Event): GeoPoint | null => {
      if (hasEventCoordinates(event)) {
        return {
          latitude: event.latitude,
          longitude: event.longitude,
        };
      }

      const organization = activeOrganizationsById.get(event.organization_id);

      if (organization?.latitude == null || organization.longitude == null) {
        return null;
      }

      return {
        latitude: organization.latitude,
        longitude: organization.longitude,
      };
    },
    [activeOrganizationsById],
  );
  const getMappableEvent = useCallback(
    (event: Event): (Event & { latitude: number; longitude: number }) | null => {
      const coordinates = getEventCoordinates(event);

      if (!coordinates) return null;

      return {
        ...event,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      };
    },
    [getEventCoordinates],
  );

  const getEventDistance = useCallback(
    (event: Event) => {
      if (!userPosition) return null;

      const eventCoordinates = getEventCoordinates(event);

      return eventCoordinates
        ? getDistanceInKilometers(userPosition, eventCoordinates)
        : null;
    },
    [getEventCoordinates, userPosition],
  );
  const isPubliclyVisibleEvent = useCallback(
    (event: Event) =>
      event.is_active &&
      !event.deleted_at &&
      !isEventSuspended(event) &&
      (event.organization_id <= 0 ||
        activeOrganizationsById.has(event.organization_id)) &&
      getEventCoordinates(event) !== null,
    [activeOrganizationsById, getEventCoordinates],
  );
  const publicDisplayableEvents = useMemo(
    () => displayableEvents.filter(isPubliclyVisibleEvent),
    [displayableEvents, isPubliclyVisibleEvent],
  );
  const popularityByEventId = useMemo(() => {
    const popularity = new Map<number, number>();

    favorites
      .filter((favorite) => !favorite.deleted_at)
      .forEach((favorite) => {
        popularity.set(
          favorite.event_id,
          (popularity.get(favorite.event_id) ?? 0) + 1,
        );
      });

    histories
      .filter((history) => !history.deleted_at)
      .forEach((history) => {
        popularity.set(
          history.event_id,
          (popularity.get(history.event_id) ?? 0) + 1,
        );
      });

    return popularity;
  }, [favorites, histories]);
  const sortEvents = useCallback(
    (eventsToSort: Event[]) =>
      [...eventsToSort].sort((firstEvent, secondEvent) => {
        if (sort === "date-desc") {
          return (
            new Date(secondEvent.start_date).getTime() -
            new Date(firstEvent.start_date).getTime()
          );
        }

        if (sort === "distance-asc") {
          const firstDistance = getEventDistance(firstEvent);
          const secondDistance = getEventDistance(secondEvent);

          if (firstDistance == null && secondDistance == null) return 0;
          if (firstDistance == null) return 1;
          if (secondDistance == null) return -1;
          if (firstDistance !== secondDistance) return firstDistance - secondDistance;

          return (
            new Date(firstEvent.start_date).getTime() -
            new Date(secondEvent.start_date).getTime()
          );
        }

        if (sort === "popularity-desc") {
          const popularityDelta =
            (popularityByEventId.get(secondEvent.id) ?? 0) -
            (popularityByEventId.get(firstEvent.id) ?? 0);

          if (popularityDelta !== 0) return popularityDelta;

          return (
            new Date(firstEvent.start_date).getTime() -
            new Date(secondEvent.start_date).getTime()
          );
        }

        if (sort === "title-asc") {
          return firstEvent.title.localeCompare(secondEvent.title, "fr-FR");
        }

        if (sort === "title-desc") {
          return secondEvent.title.localeCompare(firstEvent.title, "fr-FR");
        }

        if (sort === "city-asc") {
          return firstEvent.city.localeCompare(secondEvent.city, "fr-FR");
        }

        if (sort === "price-asc") {
          if (firstEvent.price !== secondEvent.price) {
            return firstEvent.price - secondEvent.price;
          }

          return (
            new Date(firstEvent.start_date).getTime() -
            new Date(secondEvent.start_date).getTime()
          );
        }

        if (sort === "price-desc") {
          if (firstEvent.price !== secondEvent.price) {
            return secondEvent.price - firstEvent.price;
          }

          return (
            new Date(firstEvent.start_date).getTime() -
            new Date(secondEvent.start_date).getTime()
          );
        }

        return (
          new Date(firstEvent.start_date).getTime() -
          new Date(secondEvent.start_date).getTime()
        );
      }),
    [getEventDistance, popularityByEventId, sort],
  );
  const availableCities = useMemo(
    () =>
      Array.from(
        new Set(
          publicDisplayableEvents
            .map((event) => event.city.trim())
            .filter(Boolean),
        ),
      ).sort((firstCity, secondCity) =>
        firstCity.localeCompare(secondCity, "fr-FR"),
      ),
    [publicDisplayableEvents],
  );
  const preferredCategories = useMemo(
    () =>
      currentUserId
        ? userEventPreferences
            .filter((preference) => preference.user_id === currentUserId)
            .map((preference) =>
              getEventCategorySlug(preference.event_category_id),
            )
            .filter((category): category is EventCategoryName => !!category)
        : [],
    [currentUserId, userEventPreferences],
  );
  const preferredCategorySet = useMemo(
    () => new Set(preferredCategories),
    [preferredCategories],
  );
  const shouldUsePreferredEvents =
    isUserAccount && preferredCategorySet.size > 0;
  const shouldShowPersonalizedEvents = false;
  const showRecommendedEvents = false;
  const setPersonalizedEventsView = (view: "all" | "recommended") => {
    void view;
  };
  const mapPeriod = useMemo(
    () => getPeriodRange(mapPeriodMode, mapPeriodValue),
    [mapPeriodMode, mapPeriodValue],
  );

  const filteredEvents = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    const searchCategory = EVENT_CATEGORIES.find(
      (eventCategory) => normalizeText(eventCategory) === normalizedSearch,
    );

    return sortEvents(
      publicDisplayableEvents.filter((event) => {
        if (!isEventInPeriod(event, mapPeriod.start, mapPeriod.end)) {
          return false;
        }

        const eventCategories = getEventCategories(event);
        const matchesCategory =
          category === "all" || eventCategories.includes(category);
        const matchesSearchCategory =
          !searchCategory || eventCategories.includes(searchCategory);
        const matchesCity = city === "all" || event.city === city;
        const matchesPrice =
          priceFilter === "all" ||
          (priceFilter === "free" && event.price <= 0) ||
          (priceFilter === "paid" && event.price > 0);
        const searchableContent = normalizeText(
          [
            event.title,
            event.description,
            event.address,
            event.city,
            event.postal_code,
            formatEventPrice(event.price),
            event.ticketing_link,
            eventCategories.join(" "),
            event.source ?? "",
          ].join(" "),
        );

        return (
          matchesCategory &&
          matchesSearchCategory &&
          matchesCity &&
          matchesPrice &&
          (searchCategory || searchableContent.includes(normalizedSearch))
        );
      }),
    );
  }, [
    category,
    city,
    mapPeriod.end,
    mapPeriod.start,
    priceFilter,
    publicDisplayableEvents,
    search,
    sortEvents,
  ]);

  const recommendedEvents = useMemo(
    () =>
      filteredEvents
        .filter((event) => getEventStatus(event) !== "past")
        .filter(
          (event) => getPreferenceMatchCount(event, preferredCategorySet) > 0,
        ),
    [filteredEvents, preferredCategorySet],
  );
  const shouldShowRecommendedEvents =
    shouldUsePreferredEvents && recommendedEvents.length > 0;
  const shouldShowMobileRecommendedEvents = shouldShowRecommendedEvents;
  const prioritizedEvents = useMemo(
    () =>
      userPosition
        ? sortEventsByDistanceToPoint(filteredEvents, userPosition)
        : filteredEvents,
    [filteredEvents, userPosition],
  );
  const shouldDeferEventRendering = isUserLocationLoading && !userPosition;
  const displayedEvents = useMemo(() => {
    if (shouldDeferEventRendering) return [];
    if (!userPosition) return prioritizedEvents;

    const visibleEvents = prioritizedEvents.slice(0, visibleNearbyEventCount);

    if (
      selectedEventId != null &&
      !visibleEvents.some((event) => event.id === selectedEventId)
    ) {
      const selectedVisibleEvent = prioritizedEvents.find(
        (event) => event.id === selectedEventId,
      );

      if (selectedVisibleEvent) {
        return [...visibleEvents, selectedVisibleEvent];
      }
    }

    return visibleEvents;
  }, [
    prioritizedEvents,
    selectedEventId,
    shouldDeferEventRendering,
    userPosition,
    visibleNearbyEventCount,
  ]);

  useEffect(() => {
    const initialVisibleCount =
      !userPosition && !shouldDeferEventRendering
        ? prioritizedEvents.length
        : Math.min(PROGRESSIVE_EVENT_BATCH_SIZE, prioritizedEvents.length);
    const resetTimer = window.setTimeout(() => {
      setVisibleNearbyEventCount(initialVisibleCount);
    }, 0);
    let timeoutId: number | undefined;

    if (
      shouldDeferEventRendering ||
      !userPosition ||
      prioritizedEvents.length <= PROGRESSIVE_EVENT_BATCH_SIZE
    ) {
      return () => {
        window.clearTimeout(resetTimer);
      };
    }

    const revealNextBatch = () => {
      setVisibleNearbyEventCount((currentCount) => {
        const nextCount = Math.min(
          currentCount + PROGRESSIVE_EVENT_BATCH_SIZE,
          prioritizedEvents.length,
        );

        if (nextCount < prioritizedEvents.length) {
          timeoutId = window.setTimeout(
            revealNextBatch,
            PROGRESSIVE_EVENT_BATCH_DELAY_MS,
          );
        }

        return nextCount;
      });
    };

    timeoutId = window.setTimeout(
      revealNextBatch,
      PROGRESSIVE_EVENT_BATCH_DELAY_MS,
    );

    return () => {
      window.clearTimeout(resetTimer);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [prioritizedEvents, shouldDeferEventRendering, userPosition]);

  useEffect(() => {
    if (shouldDeferEventRendering) return;
    if (!userPosition) {
      const readyTimer = window.setTimeout(() => {
        window.dispatchEvent(new Event(HOME_VISIBLE_IMAGES_READY_EVENT));
      }, 0);

      return () => {
        window.clearTimeout(readyTimer);
      };
    }

    const initialVisibleImageURLs = prioritizedEvents
      .filter((event) => getEventStatus(event) !== "past")
      .filter((event) => getEventCoordinates(event) !== null)
      .slice(0, INITIAL_NEARBY_EVENTS_COUNT)
      .map((event) => getEventThumbnailUrl(event))
      .filter(Boolean);

    if (initialVisibleImageURLs.length === 0) {
      const readyTimer = window.setTimeout(() => {
        window.dispatchEvent(new Event(HOME_VISIBLE_IMAGES_READY_EVENT));
      }, 0);

      return () => {
        window.clearTimeout(readyTimer);
      };
    }

    let isCancelled = false;
    let settledImagesCount = 0;
    const preloadedImages = initialVisibleImageURLs.map((imageURL) => {
      const image = new Image();
      let hasSettled = false;
      const markImageAsSettled = () => {
        if (hasSettled) return;

        hasSettled = true;
        settledImagesCount += 1;

        if (
          !isCancelled &&
          settledImagesCount >= initialVisibleImageURLs.length
        ) {
          window.dispatchEvent(new Event(HOME_VISIBLE_IMAGES_READY_EVENT));
        }
      };

      image.onload = markImageAsSettled;
      image.onerror = markImageAsSettled;
      image.decoding = "async";
      image.src = imageURL;
      if (image.complete) {
        markImageAsSettled();
      }
      return image;
    });

    return () => {
      isCancelled = true;
      preloadedImages.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, [getEventCoordinates, prioritizedEvents, shouldDeferEventRendering, userPosition]);

  const selectedMapEvent = useMemo(
    () =>
      mapEventSelection == null
        ? null
        : publicDisplayableEvents.find(
            (event) => event.id === mapEventSelection.eventId,
          ) ?? null,
    [mapEventSelection, publicDisplayableEvents],
  );
  const mapEvents = useMemo(
    () => {
      const visibleMapEvents = displayedEvents.filter(
        (event) =>
          getEventStatus(event) !== "past" ||
          event.id === mapEventSelection?.eventId,
      );

      if (
        selectedMapEvent &&
        getEventCoordinates(selectedMapEvent) &&
        !visibleMapEvents.some((event) => event.id === selectedMapEvent.id)
      ) {
        return [...visibleMapEvents, selectedMapEvent];
      }

      return visibleMapEvents;
    },
    [
      displayedEvents,
      getEventCoordinates,
      mapEventSelection?.eventId,
      selectedMapEvent,
    ],
  );
  const mappableMapEvents = useMemo(
    () =>
      mapEvents
        .map(getMappableEvent)
        .filter(
          (
            event,
          ): event is Event & { latitude: number; longitude: number } =>
            event !== null,
        ),
    [getMappableEvent, mapEvents],
  );
  const activeMapEventSelection = useMemo(
    () =>
      mapEventSelection &&
      mapEvents.some((event) => event.id === mapEventSelection.eventId)
        ? mapEventSelection
        : null,
    [mapEvents, mapEventSelection],
  );
  const selectedEvent = useMemo(
    () =>
      selectedEventId == null
        ? null
        : displayedEvents.find((event) => event.id === selectedEventId) ??
          publicDisplayableEvents.find((event) => event.id === selectedEventId) ??
          null,
    [displayedEvents, publicDisplayableEvents, selectedEventId],
  );
  const selectedEventCoordinates = selectedEvent
    ? getEventCoordinates(selectedEvent)
    : null;
  const selectedEventDistance = selectedEvent
    ? getEventDistance(selectedEvent)
    : null;
  const selectedEventTicketingHref = selectedEvent
    ? getTicketingHref(selectedEvent.ticketing_link)
    : null;
  const selectedEventDescription = selectedEvent
    ? removeTrailingDescriptionEllipsis(selectedEvent.description)
    : "";
  const mobileSheetMode =
    selectedEvent && mobileSheetState === "expanded" ? "detail" : mobileSheetState;
  const accountProfileHref = !currentUser
    ? ROUTES.PUBLIC.LOGIN
    : currentUser.role === "user"
      ? ROUTES.USER.PROFILE
      : currentUser.role === "organization"
        ? ROUTES.ORGANIZATION.PROFILE
        : currentUser.role === "admin"
          ? ROUTES.ADMIN.PROFILE
          : ROUTES.MODERATOR.PROFILE;
  const unreadNotificationCount = notifications.filter((notification) => {
    return (
      notification.user_id === currentUserId &&
      !notification.is_read
    );
  }).length;
  const selectedEventDirectionsHref = selectedEventCoordinates
    ? `https://www.google.com/maps/dir/?api=1&destination=${selectedEventCoordinates.latitude},${selectedEventCoordinates.longitude}`
    : null;

  const groupedEvents = useMemo(
    () =>
      displayedEvents.reduce(
        (groups, event) => {
          groups[getEventStatus(event)].push(event);

          return groups;
        },
        {
          current: [] as Event[],
          upcoming: [] as Event[],
          past: [] as Event[],
        },
      ),
    [displayedEvents],
  );
  const isSearchActive = search.trim().length > 0;
  const hasFilters =
    isSearchActive ||
    category !== "all" ||
    city !== "all" ||
    priceFilter !== "all" ||
    sort !== DEFAULT_SORT ||
    mapPeriodMode !== DEFAULT_PERIOD_MODE ||
    mapPeriodValue !== defaultMapPeriodValue;
  const shouldShowMobileFilterButton =
    isSearchFocused || search.trim().length > 0 || hasFilters;

  useEffect(() => {
    if (
      isMobile ||
      !isDesktopSearchActive ||
      !isDesktopSidebarOpen ||
      desktopSidebarView !== "list" ||
      selectedEvent ||
      !shouldFocusDesktopSidebarSearchRef.current
    ) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      shouldFocusDesktopSidebarSearchRef.current = false;
      desktopSidebarSearchInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [
    desktopSidebarView,
    isDesktopSearchActive,
    isDesktopSidebarOpen,
    isMobile,
    selectedEvent,
  ]);

  const handleMapPeriodModeChange = (mode: EventPeriodMode) => {
    setMapPeriodMode(mode);
    setMapPeriodValue(getDefaultPeriodValue(mode));
  };

  const resetFilters = () => {
    setMapPeriodMode(DEFAULT_PERIOD_MODE);
    setMapPeriodValue(defaultMapPeriodValue);
    setSearch("");
    setCategory("all");
    setCity("all");
    setPriceFilter("all");
    setSort(DEFAULT_SORT);
    setSelectedEventId(null);
    setIsDesktopSearchActive(false);
    setDesktopSidebarView("list");
    setMobileSheetState("preview");
    setOpenEventSections({
      ...createDefaultOpenEventSections(),
      past: !isMobile,
    });
  };

  const recordEventVisit = useCallback(
    (eventId: number) => {
      if (currentUser?.role !== "user" || !currentUser.user_id) return;

      void eventsApi.recordHistory(eventId).then((result) => {
        if (result.ok) {
          upsertHistory(result.data);
        }
      });
    },
    [currentUser, upsertHistory],
  );

  const selectMobileEvent = useCallback((eventId: number, shouldRecordHistory = true) => {
    if (shouldRecordHistory) {
      recordEventVisit(eventId);
    }

    setSelectedEventId(eventId);
    setMobileSheetState("expanded");
    setMapEventSelection((currentSelection) => ({
      eventId,
      requestId: (currentSelection?.requestId ?? 0) + 1,
    }));
  }, [recordEventVisit]);

  const selectSidebarEvent = useCallback((eventId: number, shouldRecordHistory = true) => {
    if (shouldRecordHistory) {
      recordEventVisit(eventId);
    }

    setSelectedEventId(eventId);
    setIsDesktopSidebarOpen(true);
    setDesktopSidebarView("list");
    setMapEventSelection((currentSelection) => ({
      eventId,
      requestId: (currentSelection?.requestId ?? 0) + 1,
    }));
  }, [recordEventVisit]);

  const handleMapEventSelect = useCallback(
    (eventId: number) => {
      if (isMobile) {
        selectMobileEvent(eventId);
        return;
      }

      selectSidebarEvent(eventId);
    },
    [isMobile, selectMobileEvent, selectSidebarEvent],
  );

  const handleShareSelectedEvent = async () => {
    if (!selectedEvent) return;

    await shareEvent(selectedEvent);
  };

  const shareEvent = async (event: Event) => {
    const shareUrl = new URL(ROUTES.PUBLIC.HOME, window.location.origin);
    shareUrl.searchParams.set("event", String(event.id));
    const shareData = {
      title: event.title,
      text: event.description,
      url: shareUrl.toString(),
    };

    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    await navigator.clipboard?.writeText(shareData.url);
  };

  const handleMobileSearchSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setSelectedEventId(null);
    setMobileSheetState("expanded");
  };

  const openDesktopSidebarList = (shouldFocusSearch = false) => {
    shouldFocusDesktopSidebarSearchRef.current = shouldFocusSearch;
    setIsDesktopSidebarOpen(true);
    setDesktopSidebarView("list");
    setSelectedEventId(null);
  };

  const activateDesktopSearch = () => {
    setIsDesktopSearchActive(true);
    openDesktopSidebarList(true);
  };

  const handleDesktopSearchSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    openDesktopSidebarList();
  };

  const openDesktopFilters = () => {
    setIsDesktopSearchActive(true);
    setIsDesktopSidebarOpen(true);
    setDesktopSidebarView("filters");
    setSelectedEventId(null);
  };

  const openFilterModal = useCallback(() => {
    setIsFilterModalOpen(true);
  }, []);

  const closeFilterModal = useCallback(() => {
    setIsFilterModalOpen(false);
  }, []);

  const toggleEventSection = (sectionKey: EventSectionKey) => {
    setOpenEventSections((sections) => ({
      ...sections,
      [sectionKey]: !sections[sectionKey],
    }));
  };

  const handleMobileSheetTouchStart = (touchEvent: TouchEvent<HTMLElement>) => {
    mobileSheetTouchStartY.current = touchEvent.touches[0]?.clientY ?? null;
  };

  const handleMobileSheetTouchEnd = (touchEvent: TouchEvent<HTMLElement>) => {
    const startY = mobileSheetTouchStartY.current;
    const endY = touchEvent.changedTouches[0]?.clientY ?? null;

    mobileSheetTouchStartY.current = null;
    if (startY == null || endY == null) return;

    const deltaY = endY - startY;
    if (deltaY < -36) {
      setMobileSheetState("expanded");
      return;
    }

    if (deltaY > 36) {
      setMobileSheetState("preview");
    }
  };

  const handleEventCardActivation = (eventId: number) => {
    if (isMobile) {
      selectMobileEvent(eventId);
      return;
    }

    selectSidebarEvent(eventId);
  };

  useEffect(() => {
    const requestedEventId = Number(
      new URLSearchParams(location.search).get("event"),
    );

    if (!Number.isInteger(requestedEventId)) return;

    const requestedEvent = publicDisplayableEvents.find(
      (event) => event.id === requestedEventId,
    );

    if (!requestedEvent || !getEventCoordinates(requestedEvent)) return;

    const focusTimer = window.setTimeout(() => {
      const eventStartDate = new Date(requestedEvent.start_date);

      if (!Number.isNaN(eventStartDate.getTime())) {
        setMapPeriodMode("month");
        setMapPeriodValue(
          `${eventStartDate.getFullYear()}-${String(
            eventStartDate.getMonth() + 1,
          ).padStart(2, "0")}`,
        );
      }

      if (getEventStatus(requestedEvent) === "past") {
        setOpenEventSections((sections) => ({ ...sections, past: true }));
      }

      recordEventVisit(requestedEventId);

      setSelectedEventId(requestedEventId);
      if (isMobile) {
        setMobileSheetState("expanded");
      } else {
        setIsDesktopSidebarOpen(true);
        setDesktopSidebarView("list");
      }
      setMapEventSelection((currentSelection) => ({
        eventId: requestedEventId,
        requestId: (currentSelection?.requestId ?? 0) + 1,
      }));
      mapSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [
    getEventCoordinates,
    isMobile,
    location.search,
    publicDisplayableEvents,
    recordEventVisit,
  ]);

  const renderEventCard = (event: Event) => {
    const eventTitle = event.title.trim() || "Événement";
    const eventDistance = getEventDistance(event);
    const eventImageUrl = getEventThumbnailUrl(event);
    const ticketingHref = getTicketingHref(event.ticketing_link);
    const eventCoordinates = getEventCoordinates(event);
    const directionsHref = eventCoordinates
      ? `https://www.google.com/maps/dir/?api=1&destination=${eventCoordinates.latitude},${eventCoordinates.longitude}`
      : null;
    const isSelectedEventCard = selectedEventId === event.id;

    return (
      <article
        aria-label={`Afficher ${eventTitle} sur la carte`}
        aria-pressed={isSelectedEventCard}
        className={`event-card event-card--interactive${
          isSelectedEventCard ? " event-card--selected" : ""
        }`}
        key={event.id}
        role="button"
        tabIndex={0}
        onClick={() => handleEventCardActivation(event.id)}
        onKeyDown={(keyboardEvent) => {
          if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;

          keyboardEvent.preventDefault();
          handleEventCardActivation(event.id);
        }}
      >
        <div className="event-card__image-frame event-image-skeleton">
          <img
            className="event-card__image"
            src={eventImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => markEventImageAsFailed(event.id)}
          />
        </div>

        <div className="event-card__content">
          <div className="event-card__tags" aria-label="Categories">
            {getEventCategories(event).map((eventCategory) => (
              <span
                className={`event-card__tag event-card__tag--${eventCategory}`}
                key={eventCategory}
              >
                {eventCategory}
              </span>
            ))}
          </div>

          <time className="event-card__date" dateTime={event.start_date}>
            {formatEventDateRange(event)}
          </time>
          <h3 className="event-card__title" title={eventTitle}>
            {eventTitle}
          </h3>
          <p>{event.description}</p>

          <dl className="event-card__details">
            <div>
              <dt>Distance</dt>
              <dd>
                {eventDistance != null
                  ? formatDistance(eventDistance)
                  : "Distance indisponible"}
              </dd>
            </div>
            <div>
              <dt>Prix</dt>
              <dd>{formatEventPrice(event.price)}</dd>
            </div>
          </dl>
          {(ticketingHref || directionsHref) && (
            <div className="event-card__links">
              {ticketingHref && (
                <a
                  className="btn btn--secondary event-card__ticketing-link event-card__link--icon-only"
                  href={ticketingHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Billetterie"
                  title="Billetterie"
                  onClick={(clickEvent) => clickEvent.stopPropagation()}
                  onKeyDown={(keyboardEvent) => keyboardEvent.stopPropagation()}
                >
                  <Ticket aria-hidden="true" size={16} />
                </a>
              )}
              {directionsHref && (
                <a
                  className="btn btn--primary event-card__directions-link event-card__link--icon-only"
                  href={directionsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Itinéraire"
                  title="Itinéraire"
                  onClick={(clickEvent) => clickEvent.stopPropagation()}
                  onKeyDown={(keyboardEvent) => keyboardEvent.stopPropagation()}
                >
                  <Navigation aria-hidden="true" size={16} />
                </a>
              )}
            </div>
          )}
          <div className="event-card__actions">
            <FavoriteButton event={event} />
            <ReportEventButton event={event} />
            {currentUser && (
              <Button
                aria-label="Partager l'événement"
                title="Partager l'événement"
                className="event-card__share"
                icon={<Share2 size={16} aria-hidden="true" />}
                iconOnly
                size="icon"
                type="button"
                variant="secondary"
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  void shareEvent(event);
                }}
                onKeyDown={(keyboardEvent) => {
                  keyboardEvent.stopPropagation();
                }}
              >
                Partager
              </Button>
            )}
          </div>
        </div>
      </article>
    );
  };

  const renderFilterControls = (submitLabel: string, onCancel: () => void) => (
    <form
      className="events-filter-modal"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        onCancel();
        setSelectedEventId(null);
        setMobileSheetState("expanded");
      }}
    >
      <section
        className="events-filter-modal__section"
        aria-labelledby="filter-period-title"
      >
        <h3 id="filter-period-title">Periode</h3>
        <div className="events-filter-modal__field-grid">
          <label className="events-filter-modal__field">
            <span>Afficher</span>
            <Select
              value={mapPeriodMode}
              onChange={(event) =>
                handleMapPeriodModeChange(event.target.value as EventPeriodMode)
              }
            >
              <option value="day">Journee</option>
              <option value="week">Semaine</option>
              <option value="month">Mois</option>
              <option value="year">Annee</option>
            </Select>
          </label>

          <label className="events-filter-modal__field">
            <span>Selection</span>
            <Input
              type={
                mapPeriodMode === "day"
                  ? "date"
                  : mapPeriodMode === "week"
                    ? "week"
                    : mapPeriodMode === "month"
                      ? "month"
                      : "number"
              }
              min={mapPeriodMode === "year" ? "1900" : undefined}
              max={mapPeriodMode === "year" ? "2100" : undefined}
              value={mapPeriodValue}
              onChange={(event) => setMapPeriodValue(event.target.value)}
            />
          </label>
        </div>
      </section>

      <section
        className="events-filter-modal__section"
        aria-labelledby="filter-refine-title"
      >
        <h3 id="filter-refine-title">Filtres</h3>
        <div className="events-filter-modal__field-grid">
          <label className="events-filter-modal__field">
            <span>Categorie</span>
            <Select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as EventCategory | "all")
              }
            >
              <option value="all">Toutes les categories</option>
              {EVENT_CATEGORIES.map((eventCategory) => (
                <option key={eventCategory} value={eventCategory}>
                  {eventCategory}
                </option>
              ))}
            </Select>
          </label>

          <label className="events-filter-modal__field">
            <span>Ville</span>
            <Select value={city} onChange={(event) => setCity(event.target.value)}>
              <option value="all">Toutes les villes</option>
              {availableCities.map((eventCity) => (
                <option key={eventCity} value={eventCity}>
                  {eventCity}
                </option>
              ))}
            </Select>
          </label>

          <label className="events-filter-modal__field">
            <span>Tarif</span>
            <Select
              value={priceFilter}
              onChange={(event) =>
                setPriceFilter(event.target.value as PriceFilter)
              }
            >
              <option value="all">Tous les tarifs</option>
              <option value="free">Gratuit</option>
              <option value="paid">Payant</option>
            </Select>
          </label>
        </div>
      </section>

      <section
        className="events-filter-modal__section"
        aria-labelledby="filter-sort-title"
      >
        <h3 id="filter-sort-title">Tri</h3>
        <label className="events-filter-modal__field">
          <span>Trier par</span>
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortValue)}
          >
            <option value="date-asc">Date la plus proche</option>
            <option value="date-desc">Date la plus eloignee</option>
            <option value="distance-asc">Proximite</option>
            <option value="popularity-desc">Popularite</option>
            <option value="title-asc">Titre A-Z</option>
            <option value="title-desc">Titre Z-A</option>
            <option value="city-asc">Ville A-Z</option>
            <option value="price-asc">Prix croissant</option>
            <option value="price-desc">Prix decroissant</option>
          </Select>
        </label>
      </section>

      <div className="events-filter-modal__actions">
        {hasFilters && (
          <Button type="button" variant="secondary" onClick={resetFilters}>
            Reinitialiser
          </Button>
        )}
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );

  return (
    <div
      className={`events-home${
        isDesktopSidebarOpen ? " events-home--sidebar-open" : " events-home--sidebar-closed"
      }${selectedEvent ? " events-home--detail" : ""}${
        isDesktopSearchActive ? " events-home--desktop-search-active" : ""
      }`}
    >
      <section className="events-home__header" ref={mapSectionRef}>
        <div
          className={`events-mobile-topbar${
            shouldShowMobileFilterButton ? " events-mobile-topbar--has-filter" : ""
          }`}
          aria-label="Actions carte"
        >
          <div className="events-account-menu">
            <NavLink
              aria-label={currentUser ? "Ouvrir la page compte" : "Connexion"}
              className="events-mobile-topbar__profile"
              to={accountProfileHref}
            >
              <UserRound size={20} aria-hidden="true" />
            </NavLink>
            <NotificationBadge
              className="events-mobile-topbar__profile-badge"
              count={unreadNotificationCount}
            />
          </div>

          <form
            className="events-mobile-search"
            role="search"
            onSubmit={handleMobileSearchSubmit}
          >
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              value={search}
              placeholder="Rechercher un événement..."
              aria-label="Rechercher un événement"
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <Button
                aria-label="Effacer la recherche"
                className="events-mobile-search__clear"
                icon={<X size={16} aria-hidden="true" />}
                iconOnly
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setSelectedEventId(null);
                }}
              >
                Effacer
              </Button>
            )}
          </form>

          {isMobile ? (
            shouldShowMobileFilterButton ? (
              <Button
                aria-label="Filtres et tri"
                className="events-mobile-topbar__filter"
                icon={<SlidersHorizontal size={19} aria-hidden="true" />}
                iconOnly
                size="icon"
                type="button"
                variant="secondary"
                onClick={openFilterModal}
                onPointerDown={(event) => {
                  event.preventDefault();
                }}
                onPointerUp={(event) => {
                  event.preventDefault();
                  openFilterModal();
                }}
              >
                Filtres
              </Button>
            ) : (
              <HeaderWeather />
            )
          ) : null}
        </div>

        <h1>Mappening</h1>
        <p>Explorez les événements disponibles autour de vous.</p>

        <EventMap
          events={mappableMapEvents}
          isInitialDataReady={isInitialDataReady}
          isUserLocationReady={!isUserLocationLoading}
          selectedEventId={activeMapEventSelection?.eventId ?? null}
          selectedEventRequestId={activeMapEventSelection?.requestId ?? 0}
          userPosition={userPosition}
          showPopups={false}
          onEventSelect={handleMapEventSelect}
          onEventImageError={markEventImageAsFailed}
        />
      </section>

      {!isMobile && (
        <div
          className="events-desktop-controls events-desktop-controls--has-weather"
          aria-label="Actions carte desktop"
        >
          {isDesktopSearchActive ? (
            <form
              className="events-desktop-search events-desktop-search--active"
              role="search"
              onSubmit={handleDesktopSearchSubmit}
            >
              <Search size={16} aria-hidden="true" />
              <input
                ref={desktopFloatingSearchInputRef}
                className="input"
                type="search"
                value={search}
                placeholder="Rechercher un événement..."
                aria-label="Rechercher un événement"
                onMouseDown={(event) => {
                  if (!isDesktopSidebarOpen) {
                    event.preventDefault();
                    openDesktopSidebarList(true);
                  }
                }}
                onClick={() => openDesktopSidebarList(true)}
                onFocus={() => {
                  setIsSearchFocused(true);
                  openDesktopSidebarList(true);
                }}
                onBlur={() => setIsSearchFocused(false)}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <Button
                  aria-label="Effacer la recherche"
                  className="events-desktop-search__clear"
                  icon={<X size={16} aria-hidden="true" />}
                  iconOnly
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSearch("");
                    setSelectedEventId(null);
                    window.requestAnimationFrame(() => {
                      desktopFloatingSearchInputRef.current?.focus();
                    });
                  }}
                >
                  Effacer
                </Button>
              )}
            </form>
          ) : (
            <button
              className="events-desktop-search events-desktop-search--trigger"
              type="button"
              onClick={activateDesktopSearch}
            >
              <Search size={16} aria-hidden="true" />
              <span className="events-desktop-search__placeholder">
                Rechercher un événement...
              </span>
            </button>
          )}

          <div className="events-desktop-controls__action">
            <HeaderWeather />
          </div>
        </div>
      )}

      <section
        className={`events-list events-list--${mobileSheetMode}${
          !isMobile && desktopSidebarView === "filters" ? " events-list--filters" : ""
        }`}
        aria-labelledby="events-list-title"
        onTouchStart={handleMobileSheetTouchStart}
        onTouchEnd={handleMobileSheetTouchEnd}
      >
        {!isMobile && desktopSidebarView === "filters" ? (
          <div className="events-sidebar-filters" aria-labelledby="events-list-title">
            <div className="events-sidebar-header events-sidebar-header--filters">
              <Button
                aria-label="Retour à la liste des événements"
                icon={<ArrowLeft size={18} aria-hidden="true" />}
                iconOnly
                size="icon"
                type="button"
                variant="secondary"
                onClick={() => setDesktopSidebarView("list")}
              >
                Retour
              </Button>
              <div>
                <p>Affiner</p>
                <h2 id="events-list-title">Filtres & Tri</h2>
              </div>
              <Button
                aria-label="Fermer la sidebar des événements"
                icon={<X size={18} aria-hidden="true" />}
                iconOnly
                size="icon"
                type="button"
                variant="secondary"
                onClick={() => setIsDesktopSidebarOpen(false)}
              >
                Fermer
              </Button>
            </div>
            {renderFilterControls("Appliquer", () => setDesktopSidebarView("list"))}
          </div>
        ) : (
          <>
        {!isMobile && !selectedEvent && (
          <div className="events-sidebar-tools">
            <Button
              aria-label="Filtres et tri"
              className="events-sidebar-tools__filter"
              icon={<SlidersHorizontal size={19} aria-hidden="true" />}
              iconOnly
              size="icon"
              type="button"
              variant="secondary"
              onClick={openDesktopFilters}
            >
              Filtres & Tri
            </Button>
            <form
              className="events-desktop-search events-desktop-search--active events-sidebar-search"
              role="search"
              onSubmit={handleDesktopSearchSubmit}
            >
              <Search size={16} aria-hidden="true" />
              <input
                ref={desktopSidebarSearchInputRef}
                className="input"
                type="search"
                value={search}
                placeholder="Rechercher un événement..."
                aria-label="Rechercher un événement"
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <Button
                  aria-label="Effacer la recherche"
                  className="events-desktop-search__clear"
                  icon={<X size={16} aria-hidden="true" />}
                  iconOnly
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSearch("");
                    setSelectedEventId(null);
                    window.requestAnimationFrame(() => {
                      desktopSidebarSearchInputRef.current?.focus();
                    });
                  }}
                >
                  Effacer
                </Button>
              )}
            </form>
            <Button
              aria-label="Fermer la sidebar des événements"
              className="events-sidebar-tools__close"
              icon={<X size={18} aria-hidden="true" />}
              iconOnly
              size="icon"
              type="button"
              variant="secondary"
              onClick={() => setIsDesktopSidebarOpen(false)}
            >
              Fermer
            </Button>
          </div>
        )}
        <div className="events-sidebar-header">
          <div>
            <p>{selectedEvent ? "Selection" : "Explorer"}</p>
            <h2 id="events-list-title">
              {selectedEvent ? "Detail de l'événement" : "Tous les événements"}
            </h2>
          </div>
          {selectedEvent && (
            <Button
              aria-label="Fermer la sidebar des événements"
              icon={<X size={18} aria-hidden="true" />}
              iconOnly
              size="icon"
              type="button"
              variant="secondary"
              onClick={() => setIsDesktopSidebarOpen(false)}
            >
              Fermer
            </Button>
          )}
        </div>
        <button
          className="events-list__sheet-handle"
          type="button"
          aria-label={
            mobileSheetMode === "preview"
              ? selectedEvent
                ? "Afficher le détail de l'événement"
                : "Afficher les événements"
              : "Réduire la liste des événements"
          }
          onClick={() => {
            setMobileSheetState((state) =>
              state === "preview" ? "expanded" : "preview",
            );
          }}
        />
        {selectedEvent ? (
          <div className="event-mobile-detail" aria-label={selectedEvent.title}>
            <div className="event-mobile-detail__actions">
              <Button
                aria-label="Retour à la liste des événements"
                className="event-mobile-detail__back"
                icon={<ArrowLeft size={18} aria-hidden="true" />}
                iconOnly
                size="icon"
                type="button"
                variant="secondary"
                onClick={() => {
                  setSelectedEventId(null);
                  setMobileSheetState("expanded");
                }}
              >
                Retour
              </Button>
              <div className="event-mobile-detail__quick-actions">
                <ReportEventButton event={selectedEvent} />
                <FavoriteButton event={selectedEvent} />
                <Button
                  aria-label="Partager l'événement"
                  title="Partager l'événement"
                  className="event-mobile-detail__share"
                  icon={<Share2 size={18} aria-hidden="true" />}
                  iconOnly
                  size="icon"
                  type="button"
                  variant="secondary"
                  onClick={handleShareSelectedEvent}
                >
                  Partager
                </Button>
              </div>
            </div>

            <div className="event-mobile-detail__heading">
              <h2>{selectedEvent.title}</h2>
            </div>

            <div className="event-mobile-detail__image-frame event-image-skeleton">
              <img
                className="event-mobile-detail__image"
                src={getEventImageUrl(selectedEvent)}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => markEventImageAsFailed(selectedEvent.id)}
              />
            </div>

            <div className="event-mobile-detail__info-grid">
              <span>
                <MapPin size={17} aria-hidden="true" />
                {selectedEvent.address}, {selectedEvent.postal_code}{" "}
                {selectedEvent.city}
              </span>
              <span>
                <CalendarDays size={17} aria-hidden="true" />
                {formatEventDateRange(selectedEvent)}
              </span>

              {selectedEventDistance != null && (
                <span>
                  <Navigation size={17} aria-hidden="true" />
                  {formatDistance(selectedEventDistance)}
                </span>
              )}
              <span>
                <Ticket size={17} aria-hidden="true" />
                {formatEventPrice(selectedEvent.price)}
              </span>
            </div>

            <div className="event-mobile-detail__categories">
              {getEventCategories(selectedEvent).map((eventCategory) => (
                <span key={eventCategory}>{eventCategory}</span>
              ))}
            </div>

            <p className="event-mobile-detail__description">
              {selectedEventDescription}
            </p>

            {selectedEventTicketingHref && (
              <a
                className="btn btn--secondary event-mobile-detail__link"
                href={selectedEventTicketingHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Lien billetterie
              </a>
            )}

            {selectedEventCoordinates && (
              <>
                <WeatherBadge
                  latitude={selectedEventCoordinates.latitude}
                  longitude={selectedEventCoordinates.longitude}
                  startDate={selectedEvent.start_date}
                />
                {selectedEventDirectionsHref && (
                  <a
                    className="btn btn--primary event-mobile-detail__maps"
                    href={selectedEventDirectionsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Itineraire
                  </a>
                )}
              </>
            )}
          </div>
        ) : (
          <>

        {showRecommendedEvents ? (
          <section
            className={`events-status-section events-status-section--collapsible${
              openEventSections.recommended ? " is-open" : ""
            }`}
            aria-labelledby="events-recommended-title"
          >
            <div className="events-status-section__header">
              <div className="events-status-section__title-actions">
                <h3 id="events-recommended-title">
                  <button
                    aria-controls="events-recommended-panel"
                    aria-expanded={openEventSections.recommended}
                    className="events-status-section__toggle"
                    type="button"
                    onClick={() => toggleEventSection("recommended")}
                  >
                    <span>Mes recommandations</span>
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className="events-status-section__toggle-icon"
                    />
                  </button>
                </h3>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() =>
                    setPersonalizedEventsView("all")
                  }
                >
                  Voir tous les événements
                </Button>
              </div>
            </div>

            <div
              className="events-status-section__collapsible"
              id="events-recommended-panel"
              aria-hidden={!openEventSections.recommended}
              inert={!openEventSections.recommended ? true : undefined}
            >
              <div className="events-status-section__collapsible-inner">
            {displayedEvents.length === 0 ? (
              <EmptyState message="Aucun événement ne correspond à vos préférences." />
            ) : (
              <div className={getEventsGridClassName(displayedEvents)}>
                {displayedEvents.map(renderEventCard)}
              </div>
            )}
              </div>
            </div>
          </section>
        ) : (
          <>
            {shouldShowPersonalizedEvents && (
              <section
                className="events-status-section"
                aria-labelledby="events-all-title"
              >
                <div className="events-status-section__header">
                  <div className="events-status-section__title-actions">
                    <h3 id="events-all-title">
                      Tous les événements
                    </h3>
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => setPersonalizedEventsView("recommended")}
                    >
                      Voir recommandes
                    </Button>
                  </div>
                </div>
              </section>
            )}

            {isSearchActive && displayedEvents.length === 0 ? (
              <EmptyState message="Aucun événement ne correspond à votre recherche." />
            ) : (
              <>
            {statusSections
              .filter((section) => section.status !== "past")
              .map((section) => {
              const sectionEvents = groupedEvents[section.status];
              const shouldRenderMobileRecommendations =
                section.status === "upcoming" && shouldShowMobileRecommendedEvents;
              const isMobileRecommendedOpen = openEventSections.mobileRecommended;
              const isSectionOpen = openEventSections[section.status];
              const sectionPanelId = `events-${section.status}-panel`;

              if (section.status === "current" && sectionEvents.length === 0) {
                return null;
              }

              if (isSearchActive && sectionEvents.length === 0) {
                return null;
              }

              return (
                <Fragment key={section.status}>
                  {shouldRenderMobileRecommendations && (
                    <section
                      className={`events-status-section events-status-section--collapsible${
                        isMobileRecommendedOpen ? " is-open" : ""
                      }`}
                      aria-labelledby="events-mobile-recommended-title"
                    >
                      <div className="events-status-section__header">
                        <h3 id="events-mobile-recommended-title">
                          <button
                            aria-controls="events-mobile-recommended-panel"
                            aria-expanded={isMobileRecommendedOpen}
                            className="events-status-section__toggle"
                            type="button"
                            onClick={() => toggleEventSection("mobileRecommended")}
                          >
                            <span>Mes recommandations</span>
                            <ChevronDown
                              size={18}
                              aria-hidden="true"
                              className="events-status-section__toggle-icon"
                            />
                          </button>
                        </h3>
                        <span>{recommendedEvents.length}</span>
                      </div>

                      <div
                        className="events-status-section__collapsible"
                        id="events-mobile-recommended-panel"
                        aria-hidden={!isMobileRecommendedOpen}
                        inert={!isMobileRecommendedOpen ? true : undefined}
                      >
                        <div className="events-status-section__collapsible-inner">
                          <div className={getEventsGridClassName(recommendedEvents)}>
                            {recommendedEvents.map(renderEventCard)}
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                <section
                  className={`events-status-section events-status-section--collapsible${
                    isSectionOpen ? " is-open" : ""
                  }`}
                  aria-labelledby={`events-${section.status}-title`}
                >
                  <div className="events-status-section__header">
                    <h3 id={`events-${section.status}-title`}>
                      <button
                        aria-controls={sectionPanelId}
                        aria-expanded={isSectionOpen}
                        className="events-status-section__toggle"
                        type="button"
                        onClick={() => toggleEventSection(section.status)}
                      >
                        <span>{section.title}</span>
                        <ChevronDown
                          size={18}
                          aria-hidden="true"
                          className="events-status-section__toggle-icon"
                        />
                      </button>
                    </h3>
                    <span>{sectionEvents.length}</span>
                  </div>

                  <div
                    className="events-status-section__collapsible"
                    id={sectionPanelId}
                    aria-hidden={!isSectionOpen}
                    inert={!isSectionOpen ? true : undefined}
                  >
                    <div className="events-status-section__collapsible-inner">
                      {sectionEvents.length === 0 ? (
                        <EmptyState message={section.empty} />
                      ) : (
                        <div className={getEventsGridClassName(sectionEvents)}>
                          {sectionEvents.map(renderEventCard)}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
                </Fragment>
              );
            })}

            {(!isSearchActive || groupedEvents.past.length > 0) && (
            <section
              className={`events-status-section events-status-section--collapsible${
                openEventSections.past ? " is-open" : ""
              }`}
              aria-labelledby="events-past-title"
            >
              <div className="events-status-section__header">
                <h3 id="events-past-title">
                  <button
                    aria-controls="events-past-panel"
                    aria-expanded={openEventSections.past}
                    className="events-status-section__toggle"
                    type="button"
                    onClick={() => toggleEventSection("past")}
                  >
                    <span>Voir les événements passés</span>
                      <ChevronDown
                        size={18}
                        aria-hidden="true"
                        className="events-status-section__toggle-icon"
                      />
                  </button>
                </h3>
              </div>

              <div
                className="events-status-section__collapsible"
                id="events-past-panel"
                aria-hidden={!openEventSections.past}
                inert={!openEventSections.past ? true : undefined}
              >
                <div className="events-status-section__collapsible-inner">
                  {groupedEvents.past.length === 0 ? (
                    <EmptyState message="Aucun événement passé ne correspond à votre recherche." />
                  ) : (
                    <div className={getEventsGridClassName(groupedEvents.past)}>
                      {groupedEvents.past.map(renderEventCard)}
                    </div>
                  )}
                </div>
              </div>
            </section>
            )}
              </>
            )}
          </>
        )}
          </>
        )}
          </>
        )}
      </section>

      <FormModal
        ariaLabel="Filtres et tri des événements"
        open={isFilterModalOpen}
        size="lg"
        onClose={closeFilterModal}
      >
        <form
          className="events-filter-modal"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            closeFilterModal();
            setSelectedEventId(null);
            setMobileSheetState("expanded");
          }}
        >
          <div className="events-filter-modal__header">
          </div>

          <section
            className="events-filter-modal__section"
            aria-labelledby="filter-period-title"
          >
            <h3 id="filter-period-title">Période</h3>
            <div className="events-filter-modal__field-grid">
              <label className="events-filter-modal__field">
                <span>Afficher</span>
                <Select
                  value={mapPeriodMode}
                  onChange={(event) =>
                    handleMapPeriodModeChange(event.target.value as EventPeriodMode)
                  }
                >
                  <option value="day">Journée</option>
                  <option value="week">Semaine</option>
                  <option value="month">Mois</option>
                  <option value="year">Année</option>
                </Select>
              </label>

              <label className="events-filter-modal__field">
                <span>Sélection</span>
                <Input
                  type={
                    mapPeriodMode === "day"
                      ? "date"
                      : mapPeriodMode === "week"
                        ? "week"
                        : mapPeriodMode === "month"
                          ? "month"
                          : "number"
                  }
                  min={mapPeriodMode === "year" ? "1900" : undefined}
                  max={mapPeriodMode === "year" ? "2100" : undefined}
                  value={mapPeriodValue}
                  onChange={(event) => setMapPeriodValue(event.target.value)}
                />
              </label>
            </div>
          </section>

          <section
            className="events-filter-modal__section"
            aria-labelledby="filter-refine-title"
          >
            <h3 id="filter-refine-title">Filtres</h3>
            <div className="events-filter-modal__field-grid">
              <label className="events-filter-modal__field">
                <span>Catégorie</span>
                <Select
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as EventCategory | "all")
                  }
                >
                  <option value="all">Toutes les catégories</option>
                  {EVENT_CATEGORIES.map((eventCategory) => (
                    <option key={eventCategory} value={eventCategory}>
                      {eventCategory}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="events-filter-modal__field">
                <span>Ville</span>
                <Select value={city} onChange={(event) => setCity(event.target.value)}>
                  <option value="all">Toutes les villes</option>
                  {availableCities.map((eventCity) => (
                    <option key={eventCity} value={eventCity}>
                      {eventCity}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="events-filter-modal__field">
                <span>Tarif</span>
                <Select
                  value={priceFilter}
                  onChange={(event) =>
                    setPriceFilter(event.target.value as PriceFilter)
                  }
                >
                  <option value="all">Tous les tarifs</option>
                  <option value="free">Gratuit</option>
                  <option value="paid">Payant</option>
                </Select>
              </label>
            </div>
          </section>

          <section
            className="events-filter-modal__section"
            aria-labelledby="filter-sort-title"
          >
            <h3 id="filter-sort-title">Tri</h3>
            <label className="events-filter-modal__field">
              <span>Trier par</span>
              <Select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortValue)}
              >
                <option value="date-asc">Date la plus proche</option>
                <option value="date-desc">Date la plus éloignée</option>
                <option value="distance-asc">Proximité</option>
                <option value="popularity-desc">Popularité</option>
                <option value="title-asc">Titre A-Z</option>
                <option value="title-desc">Titre Z-A</option>
                <option value="city-asc">Ville A-Z</option>
                <option value="price-asc">Prix croissant</option>
                <option value="price-desc">Prix decroissant</option>
              </Select>
            </label>
          </section>

          <div className="events-filter-modal__actions">
            <Button type="button" variant="secondary" onClick={closeFilterModal}>
              Annuler
            </Button>
            {hasFilters && (
              <Button type="button" variant="secondary" onClick={resetFilters}>
                Réinitialiser
              </Button>
            )}
            <Button type="submit">Valider</Button>
          </div>
        </form>
      </FormModal>
    </div>
  );
}
