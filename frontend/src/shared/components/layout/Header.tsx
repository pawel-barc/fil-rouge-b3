import useAuthStore from "../../../domains/auth/store/authStore";

import HeaderPublic from "./HeaderPublic";
import HeaderUser from "./HeaderUser";
import HeaderAdmin from "./HeaderAdmin";
import HeaderCompany from "./HeaderCompany";

export default function Header() {
  const { isAuthenticated, role } = useAuthStore();

  if (!isAuthenticated) return <HeaderPublic />;

  if (role === "admin") return <HeaderAdmin />;
  if (role === "company") return <HeaderCompany />;

  return <HeaderUser />;
}
