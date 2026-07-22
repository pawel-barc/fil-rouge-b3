import { z } from "zod";

import { isValidUploadedImageValue } from "../../../shared/utils/imageUpload";
import { CATEGORIES } from "../types/organization-categories";

const optionalUrlSchema = (message: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || URL.canParse(value), message);

export const organizationFormSchema = z.object({
  name: z.string().trim().min(2, "Le nom de l'organisation est requis"),
  contact_email: z.email("Email de contact invalide"),
  description: z
    .string()
    .trim()
    .min(10, "La description doit contenir au moins 10 caracteres"),
  website: optionalUrlSchema("URL du site invalide"),
  address: z.string().trim().min(5, "Adresse requise"),
  city: z.string().trim().min(2, "Ville requise"),
  postal_code: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "Le code postal doit contenir 5 chiffres"),
  logo: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || isValidUploadedImageValue(value),
      "Ajoutez un logo PNG, JPG ou WebP de 1 Mo maximum",
    ),
  contact_phone_number: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^\d{10}$/.test(value),
      "Le telephone doit contenir 10 chiffres",
    ),
  siret: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^\d{14}$/.test(value),
      "Le SIRET doit contenir 14 chiffres",
    ),
  categories: z
    .array(z.enum(CATEGORIES))
    .min(1, "Sélectionnez au moins une catégorie"),
});

