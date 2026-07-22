import {
  Settings2,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import LogoutButton from "../../../domains/auth/components/LogoutButton";
import { ROUTES } from "../../constants/routes";
import HeaderWeather from "./HeaderWeather";
import StaffAccountHeader from "./StaffAccountHeader";
import ThemeToggle from "./ThemeToggle";

type HeaderAdminProps = {
  staffHeaderAction?: ReactNode;
  showAccountHeader?: boolean;
};

const adminTabs = [
  {
    activePaths: [ROUTES.ADMIN.DASHBOARD, ROUTES.ADMIN.EVENTS],
    label: "Administration",
    route: ROUTES.ADMIN.DASHBOARD,
    Icon: ShieldCheck,
    sectionTitles: {
      [ROUTES.ADMIN.DASHBOARD]: "Gestion des comptes",
      [ROUTES.ADMIN.EVENTS]: "Gestion des événements",
    },
    end: true,
  },
  {
    activePaths: [
      ROUTES.MODERATOR.DASHBOARD,
      ROUTES.MODERATOR.EVENTS,
      ROUTES.MODERATOR.ORGANIZATIONS,
      ROUTES.MODERATOR.ACCOUNTS,
      ROUTES.MODERATOR.REPORTS,
    ],
    label: "Moderation",
    route: ROUTES.MODERATOR.DASHBOARD,
    Icon: ShieldAlert,
    sectionTitles: {
      [ROUTES.MODERATOR.DASHBOARD]: "Moderation des utilisateurs",
      [ROUTES.MODERATOR.EVENTS]: "Modération des événements",
      [ROUTES.MODERATOR.ORGANIZATIONS]: "Moderation des organizations",
      [ROUTES.MODERATOR.ACCOUNTS]: "Moderation des utilisateurs",
      [ROUTES.MODERATOR.REPORTS]: "Signalements",
    },
  },
  {
    label: "Profil",
    route: ROUTES.ADMIN.PROFILE,
    Icon: UserRound,
    sectionTitle: "Mon profil",
  },
  {
    label: "Parametres",
    route: ROUTES.ADMIN.PARAMETERS,
    Icon: Settings2,
    sectionTitle: "Mes parametres",
  },
] as const;

export default function HeaderAdmin({
  staffHeaderAction,
  showAccountHeader = false,
}: HeaderAdminProps) {
  if (showAccountHeader) {
    return (
      <StaffAccountHeader
        ariaLabel="Navigation administrateur"
        sectionAction={staffHeaderAction}
        tabs={adminTabs}
      />
    );
  }

  return (
    <header className="role-header">
      <nav className="role-header__nav">
        <NavLink to={ROUTES.PUBLIC.HOME}>Accueil</NavLink>
        <NavLink to={ROUTES.ADMIN.DASHBOARD}>Administration</NavLink>
        <NavLink to={ROUTES.MODERATOR.DASHBOARD}>Moderation</NavLink>
        <HeaderWeather />
        <ThemeToggle />
        <LogoutButton />
      </nav>
    </header>
  );
}
