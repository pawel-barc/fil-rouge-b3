/**Schéma de validation pour l'inscription, valide email, username et mot de passe avec règles de sécurité */
import { z } from "zod";

export const registerSchema = z
  .object({
    username: z.string().min(2, "Nom d'utilisateur trop court"),

    email: z
        .email({ message: "Format d'email invalide" })
        .nonempty("Email requis"),

    password: z
      .string()
      .min(8, "Minimum 8 caractères")
      .regex(/[a-z]/, "Une minuscule requise")
      .regex(/[A-Z]/, "Une majuscule requise")
      .regex(/[0-9]/, "Un chiffre requis")
      .regex(/[^a-zA-Z0-9]/, "Un caractère spécial requis"),

    confirmPassword: z.string().min(1, "Confirmation requise"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export type RegisterFormData = z.infer<typeof registerSchema>;
