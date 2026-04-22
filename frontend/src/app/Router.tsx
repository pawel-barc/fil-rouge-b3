/**
 * Gestion du routage avec séparation par layouts et rôles.
 * Utilise des constantes pour éviter les "magic strings".
 */

import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import useAuthStore from "../domains/auth/store/authStore";
import { ROUTES } from "../shared/constants/routes";

import Home from "../domains/events/pages/Home";
import Login from "../domains/auth/pages/Login";
import Profile from "../domains/user/pages/Profile";
import AdminDashboard from "../domains/admin/pages/AdminDashboard";
import CompanyDashboard from "../domains/company/pages/CompanyDashboard";

import PublicLayout from "../shared/layouts/PublicLayout";
import PrivateLayout from "../shared/layouts/PrivateLayout";
import AdminLayout from "../shared/layouts/AdminLayout";
import CompanyLayout from "../shared/layouts/CompanyLayout";
import Favorites from "../domains/user/pages/Favorites";
import History from "../domains/user/pages/History";

type Props = {
  children: ReactNode;
};

/**
 * Protection des routes privées
 */
const PrivateRoute = ({ children }: Props) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? (
    children
  ) : (
    <Navigate to={ROUTES.PUBLIC.LOGIN} replace />
  );
};

/**
 * Protection par rôle utilisateur
 */
const RoleRoute = ({ children, role }: Props & { role: string }) => {
  const userRole = useAuthStore((s) => s.role);

  if (!userRole) {
    return <Navigate to={ROUTES.PUBLIC.LOGIN} replace />;
  }

  return userRole === role ? (
    children
  ) : (
    <Navigate to={ROUTES.PUBLIC.HOME} replace />
  );
};

const Router = () => {
  return (
    <Routes>
      {/* PUBLIC */}
      <Route element={<PublicLayout />}>
        <Route path={ROUTES.PUBLIC.HOME} element={<Home />} />
        <Route path={ROUTES.PUBLIC.LOGIN} element={<Login />} />
      </Route>

      {/* USER */}
      <Route
        element={
          <PrivateRoute>
            <PrivateLayout />
          </PrivateRoute>
        }
      >
        <Route path={ROUTES.USER.PROFILE} element={<Profile />} />
        <Route path={ROUTES.USER.FAVORITES} element={<Favorites />} />
        <Route path={ROUTES.USER.HISTORY} element={<History />} />
      </Route>

      {/* ADMIN */}
      <Route
        element={
          <PrivateRoute>
            <RoleRoute role="admin">
              <AdminLayout />
            </RoleRoute>
          </PrivateRoute>
        }
      >
        <Route path={ROUTES.ADMIN.DASHBOARD} element={<AdminDashboard />} />
      </Route>

      {/* COMPANY */}
      <Route
        element={
          <PrivateRoute>
            <RoleRoute role="company">
              <CompanyLayout />
            </RoleRoute>
          </PrivateRoute>
        }
      >
        <Route path={ROUTES.COMPANY.DASHBOARD} element={<CompanyDashboard />} />
      </Route>

      {/* fallback */}
      <Route path="*" element={<Navigate to={ROUTES.PUBLIC.HOME} replace />} />
    </Routes>
  );
};

export default Router;
