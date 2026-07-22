import { Settings2, ShieldAlert, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import LogoutButton from "../../../domains/auth/components/LogoutButton";
import { ROUTES } from "../../constants/routes";
import HeaderWeather from "./HeaderWeather";
import StaffAccountHeader from "./StaffAccountHeader";
import ThemeToggle from "./ThemeToggle";

type HeaderModeratorProps = {
  staffHeaderAction?: ReactNode;
  showAccountHeader?: boolean;
};

export default function HeaderModerator({
  staffHeaderAction,
  showAccountHeader = false,
}: HeaderModeratorProps) {
  const moderatorTabs = [
    {
      activePaths: [
        ROUTES.MODERATOR.DASHBOARD,
        ROUTES.MODERATOR.EVENTS,
        ROUTES.MODERATOR.ORGANIZATIONS,
        ROUTES.MODERATOR.ACCOUNTS,
        ROUTES.MODERATOR.REPORTS,
      ],
      label: "Modération",
      route: ROUTES.MODERATOR.DASHBOARD,
      Icon: ShieldAlert,
      sectionTitles: {
        [ROUTES.MODERATOR.DASHBOARD]: "Modération des utilisateurs",
        [ROUTES.MODERATOR.EVENTS]: "Modération des événements",
        [ROUTES.MODERATOR.ORGANIZATIONS]: "Modération des organisations",
        [ROUTES.MODERATOR.ACCOUNTS]: "Modération des utilisateurs",
        [ROUTES.MODERATOR.REPORTS]: "Signalements",
      },
      end: true,
    },
    {
      label: "Profil",
      route: ROUTES.MODERATOR.PROFILE,
      Icon: UserRound,
      sectionTitle: "Mon profil",
    },
    {
      label: "Paramètres",
      route: ROUTES.MODERATOR.PARAMETERS,
      Icon: Settings2,
      sectionTitle: "Mes paramètres",
    },
  ] as const;

  if (showAccountHeader) {
    return (
      <StaffAccountHeader
        ariaLabel="Navigation modération"
        sectionAction={staffHeaderAction}
        tabs={moderatorTabs}
      />
    );
  }

  return (
    <header className="role-header">
      <nav className="role-header__nav">
        <NavLink to={ROUTES.PUBLIC.HOME}>Accueil</NavLink>
        {moderatorTabs.map(({ label, route }) => (
          <NavLink key={route} to={route}>
            {label}
          </NavLink>
        ))}
        <HeaderWeather />
        <ThemeToggle />
        <LogoutButton />
      </nav>
    </header>
  );
}
