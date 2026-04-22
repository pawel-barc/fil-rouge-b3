/**Schéma de validation pour les formulaires d'authentification.
 * Utilise Zod pour valider les données côté client
 */

import { z } from "zod";

export const loginSchema = z.object({
  email: z.email({ message: "Format d'email invalide" }),

  password: z.string().min(8, "Mot de passe trop court (min. 8 caractères)"),
});

export type LoginFormData = z.infer<typeof loginSchema>;
