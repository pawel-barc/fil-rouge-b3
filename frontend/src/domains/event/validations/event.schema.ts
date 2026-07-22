import { z } from "zod";

import { isValidEventImageValue } from "../../../shared/utils/imageUpload";
import { EVENT_CATEGORIES } from "../types/event-categories";
import { isValidOptionalUrl } from "../utils/event";

export const eventFormSchema = z
  .object({
    title: z.string().trim().min(3, "Le titre doit contenir au moins 3 caracteres"),
    description: z
      .string()
      .trim()
      .min(10, "La description doit contenir au moins 10 caracteres"),
    start_date: z.string().min(1, "La date de debut est requise"),
    end_date: z.string().min(1, "La date de fin est requise"),
    address: z.string().trim().min(5, "L'adresse est requise"),
    city: z.string().trim().min(2, "La ville est requise"),
    postal_code: z
      .string()
      .trim()
      .regex(/^\d{5}$/, "Le code postal doit contenir 5 chiffres"),
    categories: z
      .array(z.enum(EVENT_CATEGORIES))
      .min(1, "Sélectionnez au moins une catégorie"),
    image: z
      .string()
      .trim()
      .min(1, "L'image est requise")
      .refine(
        isValidEventImageValue,
        "Ajoutez une image PNG, JPG ou WebP de 1 Mo maximum",
      ),
    price: z
      .string()
      .trim()
      .min(1, "Le prix est requis")
      .refine((value) => {
        const numberValue = Number(value);
        return !Number.isNaN(numberValue) && numberValue >= 0;
      }, "Le prix doit etre un nombre positif ou egal a 0"),
    ticketing_link: z
      .string()
      .trim()
      .refine(isValidOptionalUrl, "L'URL de billetterie est invalide"),
    source: z.string().optional(),
  })
  .refine(
    (form) =>
      !form.start_date ||
      !form.end_date ||
      new Date(form.end_date) >= new Date(form.start_date),
    {
      path: ["end_date"],
      message: "La date de fin doit etre apres la date de debut",
    },
  );

export const getZodFieldErrors = <Fields extends string>(
  result: { success: true } | { success: false; error: z.ZodError },
) => {
  if (result.success) return {};

  return result.error.issues.reduce<Partial<Record<Fields, string>>>(
    (errors: Partial<Record<Fields, string>>, issue) => {
      const field = issue.path[0];

      if (typeof field === "string" && !errors[field as Fields]) {
        errors[field as Fields] = issue.message;
      }

      return errors;
    },
    {},
  );
};
