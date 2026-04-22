/**
 * Layout pour l'administration.
 */

import { Outlet } from "react-router-dom";
import Header from "../components/layout/Header";

export default function AdminLayout() {
  return (
    <>
      <Header />
      <main>
        <Outlet />
      </main>
    </>
  );
}
