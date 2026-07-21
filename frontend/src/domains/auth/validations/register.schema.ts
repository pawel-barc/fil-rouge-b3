import { z } from "zod";

import { CATEGORIES } from "../../organization/types/organization-categories";
import { isValidUploadedImageValue } from "../../../shared/utils/imageUpload";

const passwordSchema = z
  .string()
  .min(8, "Minimum 8 caracteres")
  .regex(/[a-z]/, "Une minuscule requise")
  .regex(/[A-Z]/, "Une majuscule requise")
  .regex(/[0-9]/, "Un chiffre requis")
  .regex(/[^a-zA-Z0-9]/, "Un caractere special requis");

const registerSchemaShape = {
  username: z.string().min(2, "Nom d'utilisateur trop court"),
  login_email: z
    .email({ message: "Format d'email invalide" })
    .nonempty("Email requis"),
  password: passwordSchema,
  confirmPassword: z.string().min(1, "Confirmation requise"),
};

export const registerSchema = z
  .object({
    ...registerSchemaShape,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export const adminRegisterSchema = z
  .object({
    ...registerSchemaShape,
    password: passwordSchema.min(12, "Minimum 12 caracteres"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export type RegisterFormData = z.infer<typeof registerSchema>;

export const organizationRegisterSchema = z
  .object({
    name: z.string().min(2, "Nom de l'organisation requis"),
    member_name: z.string().min(2, "Nom du membre requis").max(50, "Nom trop long"),
    member_job_role: z
      .string()
      .min(2, "Fonction du membre requise")
      .max(50, "Fonction trop longue"),
    login_email: z
      .email({ message: "Format d'email de connexion invalide" })
      .nonempty("Email de connexion requis"),
    contact_email: z
      .email({ message: "Format d'email de contact invalide" })
      .nonempty("Email de contact requis"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirmation requise"),
    description: z.string().min(10, "Description trop courte"),
    website: z.string().url("URL du site invalide"),
    address: z.string().min(5, "Adresse requise"),
    city: z.string().min(2, "Ville requise"),
    postal_code: z.string().regex(/^\d{5}$/, "Le code postal doit contenir 5 chiffres"),
    logo: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || isValidUploadedImageValue(value),
        "Ajoutez un logo PNG, JPG ou WebP de 1 Mo maximum",
      ),
    contact_phone_number: z
      .string()
      .regex(/^\d{10}$/, "Le telephone doit contenir 10 chiffres"),
    siret: z.string().regex(/^\d{14}$/, "Le SIRET doit contenir 14 chiffres"),
    categories: z
      .array(z.enum(CATEGORIES))
      .min(1, "Sélectionnez au moins une catégorie"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export type OrganizationRegisterFormData = z.infer<typeof organizationRegisterSchema>;
