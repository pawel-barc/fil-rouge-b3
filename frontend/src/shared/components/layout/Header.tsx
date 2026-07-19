import type { ReactNode } from "react";

import useAuthStore from "../../../domains/auth/store/authStore";

import HeaderAdmin from "./HeaderAdmin";
import HeaderModerator from "./HeaderModerator";
import HeaderPublic from "./HeaderPublic";
import HeaderUser from "./HeaderUser";

const accountTypeLabels = {
  admin: "Compte administrateur",
  moderator: "Compte modérateur",
  organization: "Utilisateur organisateur",
  user: "Compte utilisateur",
} as const;

type HeaderProps = {
  showStaffAccountHeader?: boolean;
  staffHeaderAction?: ReactNode;
};

export default function Header({
  showStaffAccountHeader = false,
  staffHeaderAction,
}: HeaderProps) {
  const { isAuthenticated, role } = useAuthStore();

  if (!isAuthenticated) return <HeaderPublic />;

  const accountType = role ? accountTypeLabels[role] : "Compte connecté";

  const headerByRole = () => {
    if (role === "admin") {
      return (
        <HeaderAdmin
          showAccountHeader={showStaffAccountHeader}
          staffHeaderAction={staffHeaderAction}
        />
      );
    }
    if (role === "moderator") {
      return (
        <HeaderModerator
          showAccountHeader={showStaffAccountHeader}
          staffHeaderAction={staffHeaderAction}
        />
      );
    }
    return <HeaderUser />;
  };

  return (
    <>
      {role !== "admin" && role !== "moderator" && (
        <div className="account-type-badge" aria-label="Type de compte connecté">
          {accountType}
        </div>
      )}
      {headerByRole()}
    </>
  );
}
