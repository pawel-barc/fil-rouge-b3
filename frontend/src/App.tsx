/**Composant principal de l'application, il gere le routage et l'affichage des notifications (toast)  */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ToastContainer } from "react-toastify";
import { useLocation } from "react-router-dom";

import Router from "./app/Router";
import { authHttpApi } from "./domains/auth/api/authHttp.api";
import useAuthStore from "./domains/auth/store/authStore";
import { EVENTS_API_MODE, eventsApi } from "./domains/event/api/events.api";
import { organizationsApi } from "./domains/organization/api/organizations.api";
import { userApi } from "./domains/user/api/user.api";
import { isAccountSuspended } from "./domains/user/types/user";
import OfflineBanner from "./shared/components/feedback/OfflineBanner";
import AppSplash from "./shared/components/layout/AppSplash";
import { ROUTES } from "./shared/constants/routes";
import useDataStore from "./shared/store/dataStore";

function App() {
  const location = useLocation();
  const isHomeRoute = location.pathname === ROUTES.PUBLIC.HOME;
  const hasHomeEventRequest =
    isHomeRoute && new URLSearchParams(location.search).has("event");
  const homeSplashKey = isHomeRoute && !hasHomeEventRequest ? location.key : null;
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const currentUser = useAuthStore((s) => s.currentUser);
  const setEvents = useDataStore((s) => s.setEvents);
  const setUserFavorites = useDataStore((s) => s.setUserFavorites);
  const setUserHistories = useDataStore((s) => s.setUserHistories);
  const setUserEventPreferences = useDataStore((s) => s.setUserEventPreferences);
  const setUserNotifications = useDataStore((s) => s.setUserNotifications);
  const setNotificationTypes = useDataStore((s) => s.setNotificationTypes);
  const upsertOrganizations = useDataStore((s) => s.upsertOrganizations);
  const upsertOrganizers = useDataStore((s) => s.upsertOrganizers);
  const [finishedSplashKey, setFinishedSplashKey] = useState<string | null>(null);
  const [homeImagesReadyKey, setHomeImagesReadyKey] = useState<string | null>(null);
  const [homeMapReadyKey, setHomeMapReadyKey] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [initialSessionUser] = useState(() => useAuthStore.getState().currentUser);
  const sessionRestorePromiseRef = useRef<ReturnType<
    typeof authHttpApi.restoreSession
  > | null>(null);
  const [hydratedUserDataKey, setHydratedUserDataKey] = useState<string | null>(
    null,
  );
  const [areEventsHydrated, setAreEventsHydrated] = useState(
    () => EVENTS_API_MODE !== "http",
  );
  const [areOrganizationsHydrated, setAreOrganizationsHydrated] = useState(
    () => EVENTS_API_MODE !== "http",
  );
  const isHomeDataReady = areEventsHydrated && areOrganizationsHydrated;
  const isHomeReady =
    isHomeDataReady &&
    !!homeSplashKey &&
    homeMapReadyKey === homeSplashKey &&
    homeImagesReadyKey === homeSplashKey;
  const showSplash = !!homeSplashKey && finishedSplashKey !== homeSplashKey;
  const userDataHydrationKey =
    EVENTS_API_MODE === "http" &&
    sessionReady &&
    currentUser?.auth_source === "api" &&
    currentUser.user_id
      ? `${currentUser.account_id}:${currentUser.user_id}:${currentUser.organization_id ?? "none"}`
      : null;
  const isUserDataReady =
    !userDataHydrationKey || hydratedUserDataKey === userDataHydrationKey;
  const hideSplash = useCallback(() => {
    if (homeSplashKey) {
      setFinishedSplashKey(homeSplashKey);
    }
  }, [homeSplashKey]);

  useEffect(() => {
    let ignore = false;

    const restoreSession = async () => {
      if (
        EVENTS_API_MODE !== "http" ||
        initialSessionUser?.auth_source !== "api"
      ) {
        if (initialSessionUser) {
          logout();
        }
        setSessionReady(true);
        return;
      }

      sessionRestorePromiseRef.current ??= authHttpApi.restoreSession();
      const result = await sessionRestorePromiseRef.current;
      if (ignore) return;

      if (result.ok) {
        login(result.data);
      } else {
        logout();
      }

      setSessionReady(true);
    };

    void restoreSession();

    return () => {
      ignore = true;
    };
  }, [initialSessionUser, login, logout]);

  useEffect(() => {
    if (currentUser && (!currentUser.is_active || isAccountSuspended(currentUser))) {
      logout();
    }
  }, [currentUser, logout]);

  useEffect(() => {
    if (EVENTS_API_MODE !== "http") return;

    let ignore = false;

    void eventsApi
      .list()
      .then((result) => {
        if (!ignore && result.ok) {
          setEvents(result.data);
        }
      })
      .finally(() => {
        if (!ignore) {
          setAreEventsHydrated(true);
        }
      });

    return () => {
      ignore = true;
    };
  }, [setEvents]);

  useEffect(() => {
    if (EVENTS_API_MODE !== "http") return;

    let ignore = false;

    void organizationsApi
      .list()
      .then((result) => {
        if (!ignore && result.ok) {
          upsertOrganizations(result.data);
        }
      })
      .finally(() => {
        if (!ignore) {
          setAreOrganizationsHydrated(true);
        }
      });

    return () => {
      ignore = true;
    };
  }, [upsertOrganizations]);

  useEffect(() => {
    if (
      EVENTS_API_MODE !== "http" ||
      !sessionReady ||
      currentUser?.auth_source !== "api" ||
      !currentUser.user_id
    ) {
      const resetTimer = window.setTimeout(() => {
        setHydratedUserDataKey(null);
      }, 0);

      return () => {
        window.clearTimeout(resetTimer);
      };
    }

    let ignore = false;
    const hydrationKey = `${currentUser.account_id}:${currentUser.user_id}:${currentUser.organization_id ?? "none"}`;

    const hydrateUserData = async () => {
      const [favoritesResult, historiesResult] = await Promise.all([
        currentUser.role === "user" ? eventsApi.listFavorites() : null,
        currentUser.role === "user" ? eventsApi.listHistory() : null,
      ]);
      const [preferencesResult, notificationsResult] = await Promise.all([
        currentUser.role === "user" ? userApi.listPreferences() : null,
        userApi.listNotifications(),
      ]);
      const notificationTypesResult = await userApi.listNotificationTypes();

      if (ignore) return;

      if (favoritesResult?.ok) {
        setUserFavorites(currentUser.user_id!, favoritesResult.data);
      }
      if (historiesResult?.ok) {
        setUserHistories(currentUser.user_id!, historiesResult.data);
      }
      if (preferencesResult?.ok) {
        setUserEventPreferences(currentUser.user_id!, preferencesResult.data);
      }
      if (notificationsResult?.ok) {
        setUserNotifications(currentUser.user_id!, notificationsResult.data);
      }
      if (notificationTypesResult?.ok) {
        setNotificationTypes(notificationTypesResult.data);
      }

      const organizationsResult =
        currentUser.role === "user" ? await organizationsApi.mine() : null;

      if (ignore || !organizationsResult?.ok) return;

      const organizations = Array.isArray(organizationsResult.data)
        ? organizationsResult.data
        : [organizationsResult.data];

      upsertOrganizations(organizations);

      const membersResults = await Promise.all(
        organizations.map((organization) =>
          organizationsApi.listMembers(organization.id),
        ),
      );

      if (ignore) return;

      upsertOrganizers(
        membersResults.flatMap((result) => (result.ok ? result.data : [])),
      );

      setHydratedUserDataKey(hydrationKey);
    };

    void hydrateUserData().finally(() => {
      if (!ignore) {
        setHydratedUserDataKey(hydrationKey);
      }
    });

    return () => {
      ignore = true;
    };
  }, [
    currentUser?.auth_source,
    currentUser?.account_id,
    currentUser?.organization_id,
    currentUser?.role,
    currentUser?.user_id,
    sessionReady,
    setUserFavorites,
    setUserHistories,
    setUserEventPreferences,
    setUserNotifications,
    setNotificationTypes,
    upsertOrganizations,
    upsertOrganizers,
  ]);

  useEffect(() => {
    const markHomeReady = () => {
      if (homeSplashKey) {
        setHomeMapReadyKey(homeSplashKey);
      }
    };
    const markHomeImagesReady = () => {
      if (homeSplashKey) {
        setHomeImagesReadyKey(homeSplashKey);
      }
    };

    window.addEventListener("mappening:home-map-ready", markHomeReady);
    window.addEventListener(
      "mappening:home-visible-images-ready",
      markHomeImagesReady,
    );

    return () => {
      window.removeEventListener("mappening:home-map-ready", markHomeReady);
      window.removeEventListener(
        "mappening:home-visible-images-ready",
        markHomeImagesReady,
      );
    };
  }, [homeSplashKey]);

  return (
    <>
      <OfflineBanner />

      {sessionReady ? (
        <Router
          isHomeDataReady={isHomeDataReady}
          isUserDataReady={isUserDataReady}
        />
      ) : (
        <div className="route-loading" role="status">
          Chargement...
        </div>
      )}

      {showSplash && (
        <AppSplash isReady={isHomeReady} onFinished={hideSplash} />
      )}

      <ToastContainer 
      position="top-right" 
      autoClose={3000} 
      theme="light" />
    </>
  );
}

export default App;
