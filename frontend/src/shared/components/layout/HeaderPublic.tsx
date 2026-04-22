import { NavLink } from "react-router-dom";
import { ROUTES } from "../../constants/routes";
export default function HeaderPublic() {
  return (
    <header>
      <nav style={{ display: "flex", justifyContent: "center", gap: "50px" }}>
        <NavLink to="/">Carte</NavLink>
        <NavLink to={ROUTES.PUBLIC.LOGIN}>Connection</NavLink>
      </nav>
    </header>
  );
}
