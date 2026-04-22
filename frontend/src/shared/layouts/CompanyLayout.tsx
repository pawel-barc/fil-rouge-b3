/**
 * Layout pour les entreprises.
 */

import { Outlet } from "react-router-dom";
import Header from "../components/layout/Header";

export default function CompanyLayout() {
  return (
    <>
      <Header />
      <main>
        <Outlet />
      </main>
    </>
  );
}
