import { NavLink } from "react-router-dom";
import { ROUTES } from "../../constants/routes";

export default function HeaderAdmin() {
  return (
    <header>
      <nav style={{ display: "flex", justifyContent: "center", gap: "50px" }}>
        <NavLink to={ROUTES.ADMIN.DASHBOARD}>Dashboard</NavLink>
        <NavLink to={ROUTES.ADMIN.EVENTS}>Événements</NavLink>
        <NavLink to={ROUTES.ADMIN.USERS}>Utilisateurs</NavLink>
      </nav>
    </header>
  );
}
