import { NavLink } from "react-router-dom";
import useAuthStore from "../../../domains/auth/store/authStore";
import { ROUTES } from "../../constants/routes";

export default function HeaderUser() {
  const user = useAuthStore((s) => s.currentUser);

  return (
    <header>
      <nav style={{ display: "flex", justifyContent: "center", gap: "50px" }}>
        <span>Bonjour {user?.username}</span>

        <NavLink to={ROUTES.PUBLIC.HOME}>Carte</NavLink>
        <NavLink to={ROUTES.USER.PROFILE}>Profil</NavLink>
        <NavLink to={ROUTES.USER.FAVORITES}>Favoris</NavLink>
        <NavLink to={ROUTES.USER.HISTORY}>Historique</NavLink>
      </nav>
    </header>
  );
}
