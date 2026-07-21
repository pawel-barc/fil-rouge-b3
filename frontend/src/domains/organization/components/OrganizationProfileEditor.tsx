import { useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import useAuthStore from "../../auth/store/authStore";
import { organizationsApi } from "../api/organizations.api";
import {
  CATEGORIES,
  getOrganizationCategoryLabel,
  type CategoryName,
} from "../types/organization-categories";
import type { Organization } from "../types/organization";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import AddressAutocomplete from "../../../shared/components/forms/AddressAutocomplete";
import ImageField from "../../../shared/components/forms/ImageField";
import Button from "../../../shared/components/ui/Button";
import Checkbox from "../../../shared/components/ui/Checkbox";
import CheckboxGroup from "../../../shared/components/ui/CheckboxGroup";
import FormField from "../../../shared/components/ui/FormField";
import Input from "../../../shared/components/ui/Input";
import Textarea from "../../../shared/components/ui/Textarea";
import useDataStore from "../../../shared/store/dataStore";
import { isValidUploadedImageValue } from "../../../shared/utils/imageUpload";

type OrganizationProfileForm = {
  name: string;
  contact_email: string;
  description: string;
  website: string;
  address: string;
  city: string;
  postal_code: string;
  logo: string;
  contact_phone_number: string;
  siret: string;
  categories: CategoryName[];
};

type OrganizationProfileErrors = Partial<Record<keyof OrganizationProfileForm, string>>;

const toForm = (organization: Organization): OrganizationProfileForm => ({
  name: organization.name,
  contact_email: organization.contact_email,
  description: organization.description ?? "",
  website: organization.website ?? "",
  address: organization.address,
  city: organization.city,
  postal_code: organization.postal_code,
  logo: organization.logo ?? "",
  contact_phone_number: organization.contact_phone_number ?? "",
  siret: organization.siret ?? "",
  categories: organization.category_slugs.filter((category): category is CategoryName =>
    CATEGORIES.includes(category as CategoryName),
  ),
});

const normalizeComparable = (value: string) => value.trim().toLowerCase();

const validateForm = (form: OrganizationProfileForm): OrganizationProfileErrors => {
  const errors: OrganizationProfileErrors = {};

  if (form.name.trim().length < 2) {
    errors.name = "Le nom de l'organization est requis";
  }

  if (!form.contact_email.includes("@")) {
    errors.contact_email = "Email invalide";
  }

  if (form.description.trim().length < 10) {
    errors.description = "La description doit contenir au moins 10 caracteres";
  }

  if (form.website && !URL.canParse(form.website)) {
    errors.website = "URL du site invalide";
  }

  if (form.logo && !isValidUploadedImageValue(form.logo)) {
    errors.logo = "Ajoutez un logo PNG, JPG ou WebP de 1 Mo maximum";
  }

  if (form.address.trim().length < 5) {
    errors.address = "Adresse requise";
  }

  if (form.city.trim().length < 2) {
    errors.city = "Ville requise";
  }

  if (!/^\d{5}$/.test(form.postal_code.trim())) {
    errors.postal_code = "Le code postal doit contenir 5 chiffres";
  }

  if (!/^\d{10}$/.test(form.contact_phone_number)) {
    errors.contact_phone_number = "Le telephone doit contenir 10 chiffres";
  }

  if (!/^\d{14}$/.test(form.siret)) {
    errors.siret = "Le SIRET doit contenir 14 chiffres";
  }

  if (form.categories.length === 0) {
    errors.categories = "Sélectionnez au moins une catégorie";
  }

  return errors;
};

export default function OrganizationProfile() {
  const user = useAuthStore((s) => s.currentUser);
  const login = useAuthStore((s) => s.login);
  const organizations = useDataStore((s) => s.organizations);
  const updateOrganization = useDataStore((s) => s.updateOrganization);
  const organization = organizations.find((item) => item.id === user?.organization_id);
  const [form, setForm] = useState<OrganizationProfileForm | null>(
    organization ? toForm(organization) : null,
  );
  const [errors, setErrors] = useState<OrganizationProfileErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = <Key extends keyof OrganizationProfileForm>(
    field: Key,
    value: OrganizationProfileForm[Key],
  ) => {
    setForm((currentForm) =>
      currentForm ? { ...currentForm, [field]: value } : currentForm,
    );
    setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
  };

  const toggleCategory = (category: CategoryName) => {
    if (!form) return;

    updateField(
      "categories",
      form.categories.includes(category)
        ? form.categories.filter((item) => item !== category)
        : [...form.categories, category],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    if (!organization || !form || !user) {
      setServerError("Impossible de charger le profil organization");
      return;
    }

    const validationErrors = validateForm(form);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }
    setIsSubmitting(true);

    const contactEmail = form.contact_email.trim();
    const siret = form.siret.trim();
    const existingContactEmail = organizations.find(
      (item) =>
        item.id !== organization.id &&
        normalizeComparable(item.contact_email) === normalizeComparable(contactEmail),
    );

    if (existingContactEmail) {
      setServerError("Cet email de contact est déjà utilisé");
      setIsSubmitting(false);
      return;
    }

    const existingSiret = organizations.find(
      (item) =>
        item.id !== organization.id &&
        normalizeComparable(item.siret ?? "") === normalizeComparable(siret),
    );

    if (existingSiret) {
      setServerError("Ce SIRET est déjà utilisé");
      setIsSubmitting(false);
      return;
    }

    const payload = {
      name: form.name.trim(),
      contact_email: contactEmail,
      description: form.description.trim(),
      website: form.website.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      postal_code: form.postal_code.trim(),
      logo: form.logo.trim(),
      contact_phone_number: form.contact_phone_number.trim(),
      siret,
      category_slugs: form.categories,
    };

    const result = await organizationsApi.update(organization.id, payload);

    if (!result.ok) {
      setServerError(result.error.message);
      setIsSubmitting(false);
      return;
    }

    updateOrganization(organization.id, result.data);
    login({
      ...user,
      username: form.name.trim(),
    });

    toast.success("Profil organisation mis à jour");
    setIsSubmitting(false);
  };

  if (!organization || !form) {
    return (
      <div className="organization-dashboard">
        <h1>Profil organization</h1>
        <ErrorMessage message="Profil organization introuvable" />
      </div>
    );
  }

  return (
    <div className="organization-dashboard">
      <section className="organization-dashboard__header">
        <h2>Profil organization</h2>
        <p>Bienvenue {user?.username}</p>
      </section>

      <section
        className="organization-event-form"
        aria-labelledby="organization-profile-title"
      >
        <h2 id="organization-profile-title">Modifier mes informations</h2>

        <form onSubmit={handleSubmit} noValidate>
          <div className="organization-event-form__grid">
            <FormField
              label="Nom de l'organization"
              htmlFor="organization-name"
              error={errors.name}
            >
              <Input
                id="organization-name"
                type="text"
                value={form.name}
                hasError={!!errors.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </FormField>

            <FormField
              label="Email de contact"
              htmlFor="organization-contact-email"
              error={errors.contact_email}
            >
              <Input
                id="organization-contact-email"
                type="email"
                value={form.contact_email}
                hasError={!!errors.contact_email}
                onChange={(event) =>
                  updateField("contact_email", event.target.value)
                }
              />
            </FormField>

            <div className="organization-event-form__wide">
              <FormField
                label="Description"
                htmlFor="organization-description"
                error={errors.description}
              >
                <Textarea
                  id="organization-description"
                  hasError={!!errors.description}
                  rows={4}
                  value={form.description}
                  onChange={(event) =>
                    updateField("description", event.target.value)
                  }
                />
              </FormField>
            </div>

            <FormField
              label="Site web"
              htmlFor="organization-website"
              error={errors.website}
            >
              <Input
                id="organization-website"
                type="url"
                value={form.website}
                hasError={!!errors.website}
                onChange={(event) => updateField("website", event.target.value)}
              />
            </FormField>

            <ImageField
              className="organization-event-form__wide"
              id="organization-logo"
              label="Logo"
              value={form.logo}
              error={errors.logo}
              onChange={(value) => updateField("logo", value)}
            />

            <AddressAutocomplete
              addressClassName="organization-event-form__wide"
              errors={{
                address: errors.address,
                city: errors.city,
                postal_code: errors.postal_code,
              }}
              ids={{
                address: "organization-address",
                city: "organization-city",
                postalCode: "organization-postal-code",
              }}
              value={{
                address: form.address,
                city: form.city,
                postal_code: form.postal_code,
              }}
              onChange={updateField}
            />

            <FormField
              label="Telephone"
              htmlFor="organization-phone"
              error={errors.contact_phone_number}
            >
              <Input
                id="organization-phone"
                type="tel"
                value={form.contact_phone_number}
                hasError={!!errors.contact_phone_number}
                onChange={(event) =>
                  updateField("contact_phone_number", event.target.value)
                }
              />
            </FormField>

            <FormField
              label="SIRET"
              htmlFor="organization-siret"
              error={errors.siret}
            >
              <Input
                id="organization-siret"
                type="text"
                value={form.siret}
                hasError={!!errors.siret}
                onChange={(event) => updateField("siret", event.target.value)}
              />
            </FormField>

            <div className="organization-event-form__wide">
              <CheckboxGroup
                error={errors.categories}
                label="Catégories"
                labelId="organization-categories"
              >
                {CATEGORIES.map((category) => (
                  <Checkbox
                    checked={form.categories.includes(category)}
                    key={category}
                    label={getOrganizationCategoryLabel(category)}
                    onChange={() => toggleCategory(category)}
                  />
                ))}
              </CheckboxGroup>
            </div>
          </div>

          {serverError && <ErrorMessage message={serverError} />}

          <Button type="submit" loading={isSubmitting} loadingLabel="Enregistrement...">
            Enregistrer le profil
          </Button>
        </form>
      </section>
    </div>
  );
}
