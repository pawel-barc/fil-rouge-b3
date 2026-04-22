/**
 * Layout pour les utilisateurs connectés.
 * Affiche le header utilisateur et les pages privées.
 */

import { Outlet } from "react-router-dom";
import Header from "../components/layout/Header";

export default function PrivateLayout() {
  return (
    <>
      <Header />
      <main>
        <Outlet />
      </main>
    </>
  );
}
