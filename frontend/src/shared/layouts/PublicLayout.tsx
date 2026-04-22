/**
 * Layout public pour les utilisateurs non connectés.
 * Contient le header public et les pages accessibles sans authentification.
 */

import { Outlet } from "react-router-dom";
import HeaderPublic from "../components/layout/HeaderPublic";

export default function PublicLayout() {
  return (
    <>
      <HeaderPublic />
      <main>
        <Outlet />
      </main>
    </>
  );
}
