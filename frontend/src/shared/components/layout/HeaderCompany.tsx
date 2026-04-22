import { NavLink } from "react-router-dom";
import { ROUTES } from "../../constants/routes";

export default function HeaderPublic() {
  return (
    <header>
      <nav style={{ display: "flex", justifyContent: "center", gap: "50px" }}>
        <NavLink to={ROUTES.PUBLIC.HOME}>Carte</NavLink>
      </nav>
    </header>
  );
}