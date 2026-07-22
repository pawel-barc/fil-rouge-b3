import { Suspense, lazy, type ReactNode } from "react";
import {
  matchPath,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  type Location,
} from "react-router-dom";

import useAuthStore from "../domains/auth/store/authStore";
import { getEventCategoryById } from "../domains/event/types/event-categories";
import { hasCurrentUserOrganizationMembership } from "../domains/organization/utils/organizerAccess";
import { isAccountSuspended, type Role } from "../domains/user/types/user";
import AdminLayout from "../shared/layouts/AdminLayout";
import ModeratorLayout from "../shared/layouts/ModeratorLayout";
import PrivateLayout from "../shared/layouts/PrivateLayout";
import PublicLayout from "../shared/layouts/PublicLayout";
import FormModal from "../shared/components/forms/FormModal";
import { ROUTES } from "../shared/constants/routes";
import useDataStore from "../shared/store/dataStore";

const Home = lazy(() => import("../domains/event/pages/Home"));
const Register = lazy(() => import("../domains/auth/pages/Register"));
const Login = lazy(() => import("../domains/auth/pages/Login"));
const ForgotPassword = lazy(
  () => import("../domains/auth/pages/ForgotPassword"),
);
const ResetPassword = lazy(() => import("../domains/auth/pages/ResetPassword"));
const Profile = lazy(() => import("../domains/user/pages/Profile"));
const AccountPageShell = lazy(
  () => import("../domains/user/components/AccountPageShell"),
);
const ChangePassword = lazy(
  () => import("../domains/user/components/ChangePassword"),
);
const AdminDashboard = lazy(
  () => import("../domains/admin/pages/AdminDashboard"),
);
const ModeratorDashboard = lazy(
  () => import("../domains/moderator/pages/ModeratorDashboard"),
);
const OrganizationsPage = lazy(
  () => import("../domains/organization/pages/OrganizationsPage"),
);
const OrganizationDetailPage = lazy(
  () => import("../domains/organization/pages/OrganizationDetailPage"),
);
const OrganizationSetup = lazy(
  () => import("../domains/organization/pages/OrganizationSetup"),
);
const OrganizationEventCreate = lazy(
  () => import("../domains/organization/components/OrganizationEventCreate"),
);
const Favorites = lazy(() => import("../domains/user/pages/Favorites"));
const History = lazy(() => import("../domains/user/pages/History"));
const Notifications = lazy(() => import("../domains/user/pages/Notifications"));
const UserEvents = lazy(() => import("../domains/user/pages/UserEvents"));
const Onboarding = lazy(() => import("../domains/user/pages/Onboarding"));
const ProfilePreferences = lazy(
  () => import("../domains/user/pages/ProfilePreferences"),
);
const NotFound = lazy(() => import("../shared/pages/NotFound"));

type Props = {
  children: ReactNode;
};

type FormModalLocationState = {
  backgroundLocation?: Location;
  formModal?: boolean;
};

type RouterProps = {
  isHomeDataReady?: boolean;
  isUserDataReady?: boolean;
};

const formModalRoutes = [
  { path: ROUTES.PUBLIC.FORGOT_PASSWORD, label: "Mot de passe oublié" },
  { path: ROUTES.PUBLIC.RESET_PASSWORD, label: "Réinitialisation du mot de passe" },
  { path: ROUTES.USER.CHANGE_PASSWORD, label: "Changement de mot de passe" },
  { path: ROUTES.USER.PARAMETERS, label: "Paramètres utilisateur" },
  { path: ROUTES.USER.BECOME_ORGANIZER, label: "Devenir organisateur" },
  { path: ROUTES.USER.CREATE_ORGANIZATION, label: "Ajouter une organisation" },
  { path: ROUTES.ORGANIZATION.CREATE, label: "Nouvel événement" },
] as const;

const getFormModalLabel = (pathname: string) =>
  formModalRoutes.find((route) =>
    matchPath({ path: route.path, end: true }, pathname),
  )?.label ?? null;

const toLocationPath = (location: Location) =>
  `${location.pathname}${location.search}${location.hash}`;

const legacyUserRedirects = [
  { from: ROUTES.LEGACY_USER.PROFILE, to: ROUTES.USER.PROFILE },
  { from: ROUTES.LEGACY_USER.FAVORITES, to: ROUTES.USER.FAVORITES },
  { from: ROUTES.LEGACY_USER.HISTORY, to: ROUTES.USER.HISTORY },
  { from: ROUTES.LEGACY_USER.NOTIFICATIONS, to: ROUTES.USER.NOTIFICATIONS },
  { from: ROUTES.LEGACY_USER.PREFERENCES, to: ROUTES.USER.PARAMETERS },
  { from: ROUTES.LEGACY_USER.ORGANIZATIONS, to: ROUTES.USER.ORGANIZATIONS },
  { from: ROUTES.LEGACY_USER.EVENTS, to: ROUTES.USER.EVENTS },
  { from: ROUTES.LEGACY_USER.CHANGE_PASSWORD, to: ROUTES.USER.CHANGE_PASSWORD },
  {
    from: ROUTES.LEGACY_USER.BECOME_ORGANIZER,
    to: ROUTES.USER.BECOME_ORGANIZER,
  },
  {
    from: ROUTES.LEGACY_USER.CREATE_ORGANIZATION,
    to: ROUTES.USER.CREATE_ORGANIZATION,
  },
] as const;

const legacyAdminRedirects = [
  { from: ROUTES.LEGACY_ADMIN.DASHBOARD, to: ROUTES.ADMIN.DASHBOARD },
  { from: ROUTES.LEGACY_ADMIN.EVENTS, to: ROUTES.ADMIN.EVENTS },
  { from: ROUTES.LEGACY_ADMIN.PROFILE, to: ROUTES.ADMIN.PROFILE },
  { from: ROUTES.LEGACY_ADMIN.PREFERENCES, to: ROUTES.ADMIN.PARAMETERS },
  { from: ROUTES.LEGACY_ADMIN.USERS, to: ROUTES.ADMIN.USERS },
] as const;

const legacyModeratorRedirects = [
  { from: ROUTES.LEGACY_MODERATOR.DASHBOARD, to: ROUTES.MODERATOR.DASHBOARD },
  { from: ROUTES.LEGACY_MODERATOR.EVENTS, to: ROUTES.MODERATOR.EVENTS },
  {
    from: ROUTES.LEGACY_MODERATOR.ORGANIZATIONS,
    to: ROUTES.MODERATOR.ORGANIZATIONS,
  },
  { from: ROUTES.LEGACY_MODERATOR.ACCOUNTS, to: ROUTES.MODERATOR.ACCOUNTS },
  { from: ROUTES.LEGACY_MODERATOR.REPORTS, to: ROUTES.MODERATOR.REPORTS },
  { from: ROUTES.LEGACY_MODERATOR.PROFILE, to: ROUTES.MODERATOR.PROFILE },
  {
    from: ROUTES.LEGACY_MODERATOR.PREFERENCES,
    to: ROUTES.MODERATOR.PARAMETERS,
  },
] as const;

const PrivateRoute = ({ children }: Props) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentUser = useAuthStore((s) => s.currentUser);
  const accounts = useDataStore((s) => s.accounts);
  const users = useDataStore((s) => s.users);

  const account = currentUser
    ? accounts.find((item) => item.id === currentUser.account_id)
    : undefined;
  const isApiBackedSession = currentUser?.auth_source === "api";
  const hasValidAccount =
    isApiBackedSession ||
    (!!account &&
      account.is_active &&
      !account.deleted_at &&
      !isAccountSuspended(account));
  const hasValidProfile =
    isApiBackedSession ||
    users.some(
        (user) =>
          user.id === currentUser?.user_id &&
          user.account_id === currentUser?.account_id &&
          !user.deleted_at,
      );

  return isAuthenticated &&
    currentUser &&
    hasValidAccount &&
    hasValidProfile ? (
    children
  ) : (
    <Navigate to={ROUTES.PUBLIC.LOGIN} replace />
  );
};

const RoleRoute = ({
  children,
  role,
  roles,
}: Props & { role?: Role; roles?: Role[] }) => {
  const userRole = useAuthStore((s) => s.currentUser?.role ?? s.role);
  const allowedRoles = roles ?? (role ? [role] : []);

  if (!userRole) {
    return <Navigate to={ROUTES.PUBLIC.LOGIN} replace />;
  }

  return allowedRoles.includes(userRole) ? (
    children
  ) : (
    <Navigate to={ROUTES.PUBLIC.HOME} replace />
  );
};

const RequireUserPreferences = ({
  children,
  isReady = true,
}: Props & { isReady?: boolean }) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const preferences = useDataStore((s) => s.userEventPreferences);
  const organizers = useDataStore((s) => s.organizers);
  const organizations = useDataStore((s) => s.organizations);
  const userId = currentUser?.role === "user" ? currentUser.user_id : undefined;
  const hasPreferences =
    !!userId &&
    preferences.some(
      (preference) =>
        preference.user_id === userId &&
        !!getEventCategoryById(preference.event_category_id),
    );
  const hasOrganizations =
    currentUser?.role === "user" &&
    hasCurrentUserOrganizationMembership(
      currentUser,
      organizers,
      organizations,
    );

  if (currentUser?.role === "user" && !isReady) {
    return routeFallback;
  }

  if (currentUser?.role === "user" && !hasPreferences && !hasOrganizations) {
    return <Navigate to={ROUTES.USER.ONBOARDING} replace />;
  }

  return children;
};

const RequireUserOrganizer = ({ children }: Props) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const organizers = useDataStore((s) => s.organizers);
  const organizations = useDataStore((s) => s.organizations);
  const hasOrganizations = hasCurrentUserOrganizationMembership(
    currentUser,
    organizers,
    organizations,
  );

  if (!hasOrganizations) {
    return <Navigate to={ROUTES.USER.PROFILE} replace />;
  }

  return children;
};

const LegacyUserRouteRedirect = ({ to }: { to: string }) => {
  const location = useLocation();

  return (
    <Navigate to={`${to}${location.search}${location.hash}`} replace />
  );
};

const LegacyRouteRedirect = ({ to }: { to: string }) => {
  const location = useLocation();

  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
};

const LegacyUserOrganizationRedirect = () => {
  const { organizationId } = useParams();

  return (
    <LegacyUserRouteRedirect
      to={ROUTES.USER.ORGANIZATION_DETAIL.replace(
        ":organizationId",
        organizationId ?? "",
      )}
    />
  );
};

const StaffPanelSection = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <section className="staff-panel-page" aria-label={title}>
    <div className="staff-panel-page__content">{children}</div>
  </section>
);

const routeFallback = (
  <div className="route-loading" role="status">
    Chargement...
  </div>
);

const Router = ({
  isHomeDataReady = true,
  isUserDataReady = true,
}: RouterProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as FormModalLocationState | null;
  const requestedFormModalLabel = locationState?.formModal
    ? getFormModalLabel(location.pathname)
    : null;
  const backgroundLocation = requestedFormModalLabel
    ? locationState?.backgroundLocation
    : undefined;
  const formModalLabel = backgroundLocation
    ? requestedFormModalLabel
    : null;
  const closeFormModal = () => {
    navigate(
      backgroundLocation ? toLocationPath(backgroundLocation) : ROUTES.PUBLIC.HOME,
      { replace: true },
    );
  };

  return (
    <>
      <Suspense fallback={routeFallback}>
        <Routes location={backgroundLocation ?? location}>
        <Route element={<PublicLayout />}>
          <Route
            path={ROUTES.PUBLIC.HOME}
            element={<Home isInitialDataReady={isHomeDataReady} />}
          />
          <Route path={ROUTES.PUBLIC.REGISTER} element={<Register />} />
          <Route path={ROUTES.PUBLIC.LOGIN} element={<Login />} />
          <Route
            path={ROUTES.PUBLIC.FORGOT_PASSWORD}
            element={<ForgotPassword />}
          />
          <Route
            path={ROUTES.PUBLIC.RESET_PASSWORD}
            element={<ResetPassword />}
          />
        </Route>

        <Route
          element={
            <PrivateRoute>
              <RoleRoute roles={["user", "admin", "moderator", "organization"]}>
                <PrivateLayout />
              </RoleRoute>
            </PrivateRoute>
          }
        >
          <Route
            path={ROUTES.USER.ACCOUNT}
            element={<Navigate to={ROUTES.USER.PROFILE} replace />}
          />
          {legacyUserRedirects.map((route) => (
            <Route
              element={<LegacyUserRouteRedirect to={route.to} />}
              key={route.from}
              path={route.from}
            />
          ))}
          <Route
            path={ROUTES.LEGACY_USER.ORGANIZATION_DETAIL}
            element={<LegacyUserOrganizationRedirect />}
          />
          <Route element={<AccountPageShell />}>
            <Route
              path={ROUTES.USER.PROFILE}
              element={
                <RequireUserPreferences isReady={isUserDataReady}>
                  <Profile />
                </RequireUserPreferences>
              }
            />
            <Route
              path={ROUTES.USER.FAVORITES}
              element={
                <RoleRoute role="user">
                  <RequireUserPreferences isReady={isUserDataReady}>
                    <Favorites />
                  </RequireUserPreferences>
                </RoleRoute>
              }
            />
            <Route
              path={ROUTES.USER.HISTORY}
              element={
                <RoleRoute role="user">
                  <RequireUserPreferences isReady={isUserDataReady}>
                    <History />
                  </RequireUserPreferences>
                </RoleRoute>
              }
            />
            <Route
              path={ROUTES.USER.NOTIFICATIONS}
              element={
                <RoleRoute roles={["user", "organization"]}>
                  <RequireUserPreferences isReady={isUserDataReady}>
                    <Notifications />
                  </RequireUserPreferences>
                </RoleRoute>
              }
            />
            <Route
              path={ROUTES.USER.PARAMETERS}
              element={
                <RoleRoute roles={["user", "admin", "moderator", "organization"]}>
                  <ProfilePreferences />
                </RoleRoute>
              }
            />
            <Route
              path={ROUTES.USER.ORGANIZATIONS}
              element={
                <RoleRoute roles={["user", "organization"]}>
                  <RequireUserPreferences isReady={isUserDataReady}>
                    <RequireUserOrganizer>
                      <OrganizationsPage />
                    </RequireUserOrganizer>
                  </RequireUserPreferences>
                </RoleRoute>
              }
            />
            <Route
              path={ROUTES.USER.EVENTS}
              element={
                <RoleRoute roles={["user", "organization"]}>
                  <RequireUserPreferences isReady={isUserDataReady}>
                    <RequireUserOrganizer>
                      <UserEvents />
                    </RequireUserOrganizer>
                  </RequireUserPreferences>
                </RoleRoute>
              }
            />
          </Route>
          <Route
            path={ROUTES.USER.CHANGE_PASSWORD}
            element={
              <RequireUserPreferences isReady={isUserDataReady}>
                <ChangePassword />
              </RequireUserPreferences>
            }
          />
          <Route path={ROUTES.USER.ONBOARDING} element={<Onboarding />} />
          <Route
            path={ROUTES.USER.ORGANIZATION_DETAIL}
            element={
              <RequireUserPreferences isReady={isUserDataReady}>
                <RequireUserOrganizer>
                  <OrganizationDetailPage />
                </RequireUserOrganizer>
              </RequireUserPreferences>
            }
          />
          <Route
            path={ROUTES.USER.BECOME_ORGANIZER}
            element={<OrganizationSetup mode="become" />}
          />
          <Route
            path={ROUTES.USER.CREATE_ORGANIZATION}
            element={<OrganizationSetup mode="create" />}
          />
        </Route>

        <Route
          element={
            <PrivateRoute>
              <RoleRoute role="admin">
                <AdminLayout />
              </RoleRoute>
            </PrivateRoute>
          }
        >
          {legacyAdminRedirects.map((route) => (
            <Route
              element={<LegacyRouteRedirect to={route.to} />}
              key={route.from}
              path={route.from}
            />
          ))}
          <Route
            path={ROUTES.ADMIN.DASHBOARD}
            element={<AdminDashboard view="accounts" />}
          />
          <Route
            path={ROUTES.ADMIN.EVENTS}
            element={<AdminDashboard view="events" />}
          />
          <Route
            path={ROUTES.ADMIN.PROFILE}
            element={
              <StaffPanelSection title="Profil">
                <Profile />
              </StaffPanelSection>
            }
          />
          <Route
            path={ROUTES.ADMIN.PARAMETERS}
            element={
              <StaffPanelSection title="Paramètres">
                <ProfilePreferences />
              </StaffPanelSection>
            }
          />
        </Route>

        <Route
          element={
            <PrivateRoute>
              <RoleRoute roles={["admin", "moderator"]}>
                <ModeratorLayout />
              </RoleRoute>
            </PrivateRoute>
          }
        >
          {legacyModeratorRedirects.map((route) => (
            <Route
              element={<LegacyRouteRedirect to={route.to} />}
              key={route.from}
              path={route.from}
            />
          ))}
          <Route
            path={ROUTES.MODERATOR.DASHBOARD}
            element={<ModeratorDashboard view="accounts" />}
          />
          <Route
            path={ROUTES.MODERATOR.EVENTS}
            element={<ModeratorDashboard view="events" />}
          />
          <Route
            path={ROUTES.MODERATOR.ORGANIZATIONS}
            element={<ModeratorDashboard view="organizations" />}
          />
          <Route
            path={ROUTES.MODERATOR.ACCOUNTS}
            element={<ModeratorDashboard view="accounts" />}
          />
          <Route
            path={ROUTES.MODERATOR.REPORTS}
            element={<ModeratorDashboard view="reports" />}
          />
          <Route
            path={ROUTES.MODERATOR.PROFILE}
            element={
              <StaffPanelSection title="Profil">
                <Profile />
              </StaffPanelSection>
            }
          />
          <Route
            path={ROUTES.MODERATOR.PARAMETERS}
            element={
              <StaffPanelSection title="Paramètres">
                <ProfilePreferences />
              </StaffPanelSection>
            }
          />
        </Route>

        <Route
          element={
            <PrivateRoute>
              <PrivateLayout />
            </PrivateRoute>
          }
        >
          <Route
            path={ROUTES.ORGANIZATION.DASHBOARD}
            element={<Navigate to={ROUTES.USER.PROFILE} replace />}
          />
          <Route
            path={ROUTES.ORGANIZATION.PROFILE}
            element={<Navigate to={ROUTES.USER.PROFILE} replace />}
          />
          <Route
            path={ROUTES.ORGANIZATION.EVENTS}
            element={<Navigate to={ROUTES.USER.EVENTS} replace />}
          />
          <Route
            path={ROUTES.ORGANIZATION.CREATE}
            element={
              <RoleRoute roles={["user", "organization"]}>
                <RequireUserOrganizer>
                  <OrganizationEventCreate />
                </RequireUserOrganizer>
              </RoleRoute>
            }
          />
        </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>

      {backgroundLocation && formModalLabel && (
        <FormModal
          ariaLabel={formModalLabel}
          open
          size="lg"
          onClose={closeFormModal}
        >
          <Suspense fallback={routeFallback}>
            <Routes location={location}>
              <Route
                path={ROUTES.PUBLIC.FORGOT_PASSWORD}
                element={<ForgotPassword />}
              />
              <Route
                path={ROUTES.PUBLIC.RESET_PASSWORD}
                element={<ResetPassword />}
              />
              <Route
                path={ROUTES.USER.CHANGE_PASSWORD}
                element={
                  <PrivateRoute>
                    <RoleRoute roles={["user", "admin", "moderator", "organization"]}>
                      <RequireUserPreferences isReady={isUserDataReady}>
                        <ChangePassword />
                      </RequireUserPreferences>
                    </RoleRoute>
                  </PrivateRoute>
                }
              />
              <Route
                path={ROUTES.USER.PARAMETERS}
                element={
                  <PrivateRoute>
                    <RoleRoute roles={["user", "admin", "moderator", "organization"]}>
                      <ProfilePreferences />
                    </RoleRoute>
                  </PrivateRoute>
                }
              />
              <Route
                path={ROUTES.USER.BECOME_ORGANIZER}
                element={
                  <PrivateRoute>
                    <RoleRoute roles={["user", "organization"]}>
                      <OrganizationSetup mode="become" />
                    </RoleRoute>
                  </PrivateRoute>
                }
              />
              <Route
                path={ROUTES.USER.CREATE_ORGANIZATION}
                element={
                  <PrivateRoute>
                    <RoleRoute roles={["user", "organization"]}>
                      <OrganizationSetup mode="create" />
                    </RoleRoute>
                  </PrivateRoute>
                }
              />
              <Route
                path={ROUTES.ORGANIZATION.CREATE}
                element={
                  <PrivateRoute>
                    <RoleRoute roles={["user", "organization"]}>
                      <RequireUserOrganizer>
                        <OrganizationEventCreate />
                      </RequireUserOrganizer>
                    </RoleRoute>
                  </PrivateRoute>
                }
              />
            </Routes>
          </Suspense>
        </FormModal>
      )}
    </>
  );
};

export default Router;
