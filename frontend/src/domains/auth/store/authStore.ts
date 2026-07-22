/**
 * Ce fichier gère l'état global de l'authentification avec Zustand.
 * Il permet de stocker l'utilisateur connecté, son rôle
 * et de persister ces informations dans le localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { isAccountSuspended } from "../../user/types/user";
import type { AuthenticatedUser } from "../../user/types/user";
import type { AuthState } from "./types";

const normalizeAuthenticatedUser = (
  user: AuthenticatedUser,
): AuthenticatedUser => user;

const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      currentUser: null,
      role: null,
      login: (user) => {
        const normalizedUser = normalizeAuthenticatedUser(user);

        if (!normalizedUser.is_active || isAccountSuspended(normalizedUser)) {
          set({
            isAuthenticated: false,
            currentUser: null,
            role: null,
          });
          return false;
        }
        set({
          isAuthenticated: true,
          currentUser: normalizedUser,
          role: normalizedUser.role,
        });
        return true;
      },
      logout: () => {
        set({
          isAuthenticated: false,
          currentUser: null,
          role: null,
        });
      },
      updateUser: (updatedUser) => {
        set((state) => ({
          currentUser: state.currentUser
            ? normalizeAuthenticatedUser({
                ...state.currentUser,
                ...updatedUser,
              })
            : null,
        }));
      },
    }),
    {
      name: "auth-storage-v4",
      onRehydrateStorage: () => (state) => {
        if (!state?.currentUser) return;

        const normalizedUser = normalizeAuthenticatedUser(state.currentUser);
        state.currentUser = normalizedUser;
        state.role = normalizedUser.role;
      },
    },
  ),
);

export default useAuthStore;
