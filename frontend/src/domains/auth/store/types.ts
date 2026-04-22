/**Ce fichier definit le type AuthState
 * Il représente l'état global de l'authentification dans l'application
 */
import type { User, Role } from "../../user/types/user";

/**AuthState décrit :
 * - si l'utilisateur est connecté
 * - les informations de l'utilisateur courant
 * - son rôle (user, admin, company)
 * - les fonctions pour se connecter et se déconnecter
 */
export type AuthState = {
  isAuthenticated: boolean;
  currentUser: User | null;
  role: Role | null;

  login: (user: User) => void;
  logout: () => void;
};
