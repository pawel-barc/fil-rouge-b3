import {
  ArrowLeft,
  Bell,
  Building2,
  CalendarDays,
  Clock3,
  Heart,
  LogOut,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { FormModalLink } from "../../../shared/components/forms/FormModalLink";
import Button from "../../../shared/components/ui/Button";
import { ROUTES } from "../../../shared/constants/routes";
import useDataStore from "../../../shared/store/dataStore";
import {
  accountRoleLabels,
  formatMemberSince,
  getAccountInitials,
} from "../../../shared/utils/account";
import useAuthStore from "../../auth/store/authStore";
import { authHttpApi } from "../../auth/api/authHttp.api";
import NotificationBadge from "../../notification/components/NotificationBadge";
import { getCurrentUserOrganizationMemberships } from "../../organization/utils/organizerAccess";

type AccountSection =
  | "profile"
  | "favorites"
  | "preferences"
  | "history"
  | "notifications"
  | "organizations"
  | "events";

const accountSections = [
  {
    key: "profile",
    label: "Profil",
    title: "Mon profil",
    route: ROUTES.USER.PROFILE,
    Icon: UserRound,
  },
  {
    key: "preferences",
    label: "Paramètres",
    title: "Mes paramètres",
    route: ROUTES.USER.PARAMETERS,
    Icon: Settings2,
  },
  {
    key: "notifications",
    label: "Notifications",
    title: "Mes notifications",
    route: ROUTES.USER.NOTIFICATIONS,
    Icon: Bell,
  },
  {
    key: "favorites",
    label: "Favoris",
    title: "Mes favoris",
    route: ROUTES.USER.FAVORITES,
    Icon: Heart,
  },
  {
    key: "history",
    label: "Historique",
    title: "Mon historique",
    route: ROUTES.USER.HISTORY,
    Icon: Clock3,
  },
  {
    key: "organizations",
    label: "Organisations",
    title: "Mes organisations",
    route: ROUTES.USER.ORGANIZATIONS,
    Icon: Building2,
  },
  {
    key: "events",
    label: "Événements",
    title: "Mes événements",
    route: ROUTES.USER.EVENTS,
    Icon: CalendarDays,
  },
] as const;

const organizerOnlySections: AccountSection[] = ["organizations", "events"];
const organizationSections: AccountSection[] = [
  "profile",
  "preferences",
  "notifications",
  "organizations",
  "events",
];

const getActiveAccountSection = (pathname: string): AccountSection => {
  const activeSection = accountSections.find((section) => section.route === pathname);

  return activeSection?.key ?? "profile";
};

export default function AccountPageShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const accounts = useDataStore((s) => s.accounts);
  const users = useDataStore((s) => s.users);
  const organizations = useDataStore((s) => s.organizations);
  const organizers = useDataStore((s) => s.organizers);
  const events = useDataStore((s) => s.events);
  const notifications = useDataStore((s) => s.notifications);
  const moderationReports = useDataStore((s) => s.moderationReports);
  const userId = currentUser?.user_id;
  const user = users.find((item) => item.id === userId && !item.deleted_at);
  const account = accounts.find(
    (item) => item.id === currentUser?.account_id && !item.deleted_at,
  );
  const userOrganizationMemberships = getCurrentUserOrganizationMemberships(
    currentUser,
    organizers,
    organizations,
  );
  const userOrganizationIds = new Set(
    userOrganizationMemberships.map(({ organization }) => organization.id),
  );
  const organizationCount = userOrganizationMemberships.length;
  const createdEventCount = events.filter(
    (event) => userOrganizationIds.has(event.organization_id) && !event.deleted_at,
  ).length;
  const hasOrganizations = organizationCount > 0;
  const memberSince = formatMemberSince(
    currentUser?.created_at ?? account?.created_at ?? user?.created_at,
  );
  const displayName = currentUser?.username ?? "Utilisateur";
  const email = currentUser?.login_email ?? "Compte utilisateur";
  const roleLabel = currentUser
    ? currentUser.role === "organization"
      ? "Organisateur"
      : accountRoleLabels[currentUser.role]
    : "Utilisateur";
  const activeSection = getActiveAccountSection(location.pathname);
  const isStaffAccount =
    currentUser?.role === "admin" || currentUser?.role === "moderator";
  const staffProfileRoute =
    currentUser?.role === "admin"
      ? ROUTES.ADMIN.PROFILE
      : ROUTES.MODERATOR.PROFILE;
  const staffPreferencesRoute =
    currentUser?.role === "admin"
      ? ROUTES.ADMIN.PARAMETERS
      : ROUTES.MODERATOR.PARAMETERS;
  const staffDashboardRoute =
    currentUser?.role === "admin"
      ? ROUTES.ADMIN.DASHBOARD
      : ROUTES.MODERATOR.DASHBOARD;
  const staffDashboardLabel =
    currentUser?.role === "admin"
      ? "Acceder a l'administration"
      : "Acceder a la moderation";
  const handledReportCount = moderationReports.filter(
    (report) =>
      report.handled_by_user_id === currentUser?.user_id &&
      (report.status === "resolved" || report.status === "dismissed"),
  ).length;
  const staffScopeLabel =
    currentUser?.role === "admin"
      ? "Acces complet a la plateforme"
      : `${handledReportCount} signalement${
          handledReportCount > 1 ? "s" : ""
        } traite${handledReportCount > 1 ? "s" : ""}`;
  const activeSectionTitle =
    accountSections.find((section) => section.key === activeSection)?.title ??
    "Compte";
  const visibleAccountSections =
    currentUser?.role === "organization"
      ? accountSections.filter((section) =>
          organizationSections.includes(section.key),
        )
      : currentUser?.role === "user"
      ? accountSections.filter(
          (section) => hasOrganizations || !organizerOnlySections.includes(section.key),
        )
      : accountSections.filter((section) =>
          ["profile", "preferences"].includes(section.key),
        );
  const unreadNotificationCount = notifications.filter((notification) => {
    return (
      notification.user_id === userId &&
      !notification.is_read
    );
  }).length;

  const handleLogout = async () => {
    await authHttpApi.logout();
    logout();
    navigate(ROUTES.PUBLIC.LOGIN, { replace: true });
  };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  if (isStaffAccount && location.pathname === ROUTES.USER.PROFILE) {
    return <Navigate to={staffProfileRoute} replace />;
  }

  if (isStaffAccount && location.pathname === ROUTES.USER.PARAMETERS) {
    return <Navigate to={staffPreferencesRoute} replace />;
  }

  return (
    <section className="account-shell" aria-labelledby="account-title">
      <header className="account-shell__header">
        <Link className="account-shell__home-link" to={ROUTES.PUBLIC.HOME}>
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Accueil</span>
        </Link>
        <h1 id="account-title">Compte</h1>
      </header>

      <div className="account-shell__sticky">
        <div className="account-summary">
          <div className="account-summary__avatar" aria-hidden="true">
            {getAccountInitials(displayName)}
          </div>
          <div className="account-summary__identity">
            <strong>{displayName}</strong>
            <span>{email}</span>
            <span className="account-summary__role">{roleLabel}</span>
          </div>
          <Button
            aria-label="Se déconnecter"
            className="account-summary__logout"
            icon={<LogOut size={17} aria-hidden="true" />}
            type="button"
            variant="secondary"
            onClick={handleLogout}
          >
            Déconnexion
          </Button>
          <div
            className={`account-summary__meta${
              hasOrganizations ? " account-summary__meta--organizer" : ""
            }${isStaffAccount ? " account-summary__meta--staff" : ""}`}
            aria-label="Résumé du compte"
          >
            <span className="account-summary__member-since">
              Membre depuis {memberSince}
            </span>
            {isStaffAccount ? (
              <>
                <span>
                  <ShieldCheck size={16} aria-hidden="true" />
                  {staffScopeLabel}
                </span>
                <Link className="btn account-summary__dashboard-link" to={staffDashboardRoute}>
                  {staffDashboardLabel}
                </Link>
              </>
            ) : hasOrganizations ? (
              <>
                <span>
                  {organizationCount} organisation
                  {organizationCount > 1 ? "s" : ""}
                </span>
                <span>
                  {createdEventCount} événement
                  {createdEventCount > 1 ? "s" : ""}
                  {createdEventCount > 1 ? "s" : ""}
                </span>
              </>
            ) : (
              <FormModalLink
                className="btn account-summary__organizer-link"
                to={ROUTES.USER.BECOME_ORGANIZER}
              >
                Devenir organisateur
              </FormModalLink>
            )}
          </div>
        </div>

        <nav className="account-tabs" aria-label="Sections du compte">
          {visibleAccountSections.map(({ key, label, route, Icon }) => (
            <NavLink
              className={({ isActive }) =>
                [
                  "account-tabs__item",
                  isActive || activeSection === key ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
              key={key}
              to={route}
            >
              <Icon size={18} aria-hidden="true" />
              {key === "notifications" && (
                <NotificationBadge
                  className="account-tabs__badge"
                  count={unreadNotificationCount}
                />
              )}
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <h2 className="account-shell__section-title">{activeSectionTitle}</h2>
      </div>

      <div className="account-shell__content">
        <Outlet />
      </div>
    </section>
  );
}
