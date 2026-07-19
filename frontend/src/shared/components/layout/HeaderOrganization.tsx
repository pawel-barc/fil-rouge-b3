import { NavLink } from "react-router-dom";

import LogoutButton from "../../../domains/auth/components/LogoutButton";
import { useOrganizationAccess } from "../../../domains/organization/hooks/useOrganizationAccess";
import NotificationCenter from "../../../domains/notification/components/NotificationCenter";
import { FormModalNavLink } from "../forms/FormModalLink";
import { ROUTES } from "../../constants/routes";
import HeaderWeather from "./HeaderWeather";
import ThemeToggle from "./ThemeToggle";

export default function HeaderOrganization() {
  const { canManageEvents } = useOrganizationAccess();

  return (
    <header className="role-header">
      <nav className="role-header__nav">
        <NavLink to={ROUTES.PUBLIC.HOME}>Accueil</NavLink>
        <NavLink to={ROUTES.USER.PROFILE}>Profil</NavLink>
        <NavLink to={ROUTES.USER.PARAMETERS}>Parametres</NavLink>
        <NavLink to={ROUTES.USER.ORGANIZATIONS}>Mes organisations</NavLink>
        <NavLink to={ROUTES.USER.EVENTS}>Mes événements</NavLink>
        {canManageEvents && (
          <FormModalNavLink to={ROUTES.ORGANIZATION.CREATE}>
            Nouvel événement
          </FormModalNavLink>
        )}
        <NotificationCenter />
        <HeaderWeather />
        <ThemeToggle />
        <LogoutButton />
      </nav>
    </header>
  );
}
