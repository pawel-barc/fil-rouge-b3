import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, LogOut, ShieldCheck, type LucideIcon } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { authHttpApi } from "../../../domains/auth/api/authHttp.api";
import useAuthStore from "../../../domains/auth/store/authStore";
import Button from "../ui/Button";
import { ROUTES } from "../../constants/routes";
import useDataStore from "../../store/dataStore";
import {
  accountRoleLabels,
  formatMemberSince,
  getAccountInitials,
} from "../../utils/account";

type StaffAccountTab = {
  activePaths?: readonly string[];
  label: string;
  route: string;
  Icon: LucideIcon;
  sectionTitle?: string;
  sectionTitles?: Partial<Record<string, string>>;
  end?: boolean;
};

type Props = {
  ariaLabel: string;
  sectionAction?: ReactNode;
  tabs: readonly StaffAccountTab[];
};

export default function StaffAccountHeader({
  ariaLabel,
  sectionAction,
  tabs,
}: Props) {
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const accounts = useDataStore((s) => s.accounts);
  const moderationReports = useDataStore((s) => s.moderationReports);
  const users = useDataStore((s) => s.users);
  const user = users.find(
    (item) => item.id === currentUser?.user_id && !item.deleted_at,
  );
  const account = accounts.find(
    (item) => item.id === currentUser?.account_id && !item.deleted_at,
  );
  const displayName = currentUser?.username ?? "Utilisateur";
  const email = currentUser?.login_email ?? "Compte utilisateur";
  const roleLabel = currentUser
    ? accountRoleLabels[currentUser.role]
    : "Utilisateur";
  const memberSince = formatMemberSince(
    currentUser?.created_at ?? account?.created_at ?? user?.created_at,
  );
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
  const activeTab = tabs.find(
    ({ activePaths, route }) =>
      location.pathname === route || activePaths?.includes(location.pathname),
  );
  const activeSectionTitle =
    activeTab?.sectionTitles?.[location.pathname] ?? activeTab?.sectionTitle;

  const handleLogout = async () => {
    await authHttpApi.logout();
    logout();
    navigate(ROUTES.PUBLIC.LOGIN, { replace: true });
  };

  useEffect(() => {
    const header = headerRef.current;

    if (!header) return;

    const updateHeaderHeight = () => {
      setHeaderHeight(header.getBoundingClientRect().height);
    };

    updateHeaderHeight();

    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(header);

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <section
        className="account-shell account-shell--role-header"
        ref={headerRef}
        aria-labelledby="account-title"
      >
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
              Deconnexion
            </Button>
            <div
              className="account-summary__meta account-summary__meta--staff"
              aria-label="Resume du compte"
            >
              <span className="account-summary__member-since">
                Membre depuis {memberSince}
              </span>
              <span className="account-summary__member-since">
                <ShieldCheck size={16} aria-hidden="true" />
                {staffScopeLabel}
              </span>
            </div>
          </div>

          <nav className="account-tabs account-tabs--role" aria-label={ariaLabel}>
            {tabs.map(({ activePaths, label, route, Icon, end }) => (
              <NavLink
                className={({ isActive }) =>
                  [
                    "account-tabs__item",
                    isActive || activePaths?.includes(location.pathname)
                      ? "is-active"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
                end={end}
                key={route}
                to={route}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          {activeSectionTitle && (
            <div className="account-shell__section-header">
              <h2 className="account-shell__section-title">
                {activeSectionTitle}
              </h2>
              {sectionAction && (
                <div className="account-shell__section-action">
                  {sectionAction}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      <div
        className="account-shell__role-header-spacer"
        style={{ height: headerHeight }}
        aria-hidden="true"
      />
    </>
  );
}
