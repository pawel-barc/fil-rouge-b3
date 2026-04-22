/**Centralisation des routes de l'application */

export const ROUTES = {
  PUBLIC: { HOME: "/", LOGIN: "/login" },

  USER: { PROFILE: "/profile", FAVORITES: "/favorites", HISTORY: "/history" },

  ADMIN: {
    DASHBOARD: "/admin",
    EVENTS: "/admin/events",
    USERS: "/admin/users",
  },
  COMPANY: {
    DASHBOARD: "/company",
    EVENTS: "/company/events",
    CREATE: "/company/create",
  },
} as const;
