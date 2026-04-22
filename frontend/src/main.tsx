/**Point d'entrée principal de l'application 
 * Ce fichier initialise le rendue de l'application, active le routage avec BrowserRouter et applique StrictMode pour détecter les erreurs.
*/
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);