/**
 * Ce fichier contient les types TypeScript liés à l'utilisateur.
 * L'objectif est de centraliser la structure des données (User, Role, Preferences) pour assurer la cohérence dans toute l'application (frontend)*/

/**Liste des rôles disponibles dans l'application */
export const ROLES = [
  "user",
  "admin",
  "company",
] as const; /** "as const" permet de dire à TypeScript que les valeurs sont fixes (read only) */

/**Création du type Role à partir du tableau ROLES
 * "typeof ROLES" récupère le type du tableau, "[number]" signifie : prends n'importe quel élément du tableau*/
export type Role = (typeof ROLES)[number];

/**Type représentant les préférences de l'utilisateur
 * Un objet avec des valeurs booléennes pour activer/désactiver certaines catégories d'événements
 */
export type Preferences = {
  jour: boolean;
  culture: boolean;
  musique: boolean;
  art: boolean;
  tourisme: boolean;
  associatif: boolean;
  famille: boolean;
  sport: boolean;
};

/**Type principal représentant un utilisateur */
export type User = {
  id: number;
  username: string;
  email: string;
  password: string;
  role: Role;
  preferences: Preferences;
};
