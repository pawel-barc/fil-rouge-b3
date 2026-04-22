/**
 * Ce fichier gère l'état global de l'authentification avec Zustand.
 * Il permet de stocker l'utilisateur connecté, son rôle
 * et de persister ces informations dans le localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { AuthState } from "./types";

const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      currentUser: null,
      role: null,

      /**
       * Connecte un utilisateur (mock ou réel).
       * Met à jour l'état global avec ses informations.
       */
      login: (user) => {
        set({
          isAuthenticated: true,
          currentUser: user,
          role: user.role,
        });
      },

      /**
       * Déconnecte l'utilisateur.
       * Réinitialise l'état.
       */
      logout: () => {
        set({
          isAuthenticated: false,
          currentUser: null,
          role: null,
        });
      },
    }),
    {
      name: "auth-storage", // clé dans le localStorage
    },
  ),
);

export default useAuthStore;
