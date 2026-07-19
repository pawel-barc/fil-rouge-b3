import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import AddressAutocomplete from "../../../shared/components/forms/AddressAutocomplete";
import ImageField from "../../../shared/components/forms/ImageField";
import ActionRow from "../../../shared/components/layout/ActionRow";
import Button from "../../../shared/components/ui/Button";
import Checkbox from "../../../shared/components/ui/Checkbox";
import CheckboxGroup from "../../../shared/components/ui/CheckboxGroup";
import FormField from "../../../shared/components/ui/FormField";
import Input from "../../../shared/components/ui/Input";
import Textarea from "../../../shared/components/ui/Textarea";
import { ROUTES } from "../../../shared/constants/routes";
import useDataStore from "../../../shared/store/dataStore";
import useAuthStore from "../../auth/store/authStore";
import { organizationsApi } from "../api/organizations.api";
import { CATEGORIES, type OrganizationCategoryName } from "../types/organization-categories";
import {
  emptyOrganizationForm,
  emptyOrganizerProfileForm,
  validateOrganizationForm,
  validateOrganizerProfileForm,
  type OrganizationForm,
  type OrganizationFormErrors,
  type OrganizerProfileErrors,
  type OrganizerProfileForm,
} from "../utils/organizationWorkflow";
import { hasCurrentUserOrganizationMembership } from "../utils/organizerAccess";

type Props = {
  mode?: "become" | "create";
};

export default function OrganizationSetup({ mode = "become" }: Props) {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const organizations = useDataStore((s) => s.organizations);
  const organizers = useDataStore((s) => s.organizers);
  const upsertOrganizations = useDataStore((s) => s.upsertOrganizations);
  const upsertOrganizers = useDataStore((s) => s.upsertOrganizers);
  const [step, setStep] = useState(0);
  const [organizerForm, setOrganizerForm] = useState<OrganizerProfileForm>(
    emptyOrganizerProfileForm,
  );
  const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(
    emptyOrganizationForm,
  );
  const [organizerErrors, setOrganizerErrors] = useState<OrganizerProfileErrors>({});
  const [organizationErrors, setOrganizationErrors] =
    useState<OrganizationFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userId = currentUser?.user_id;
  const hasOrganizations = hasCurrentUserOrganizationMembership(
    currentUser,
    organizers,
    organizations,
  );
  const title =
    mode === "create" || hasOrganizations
      ? "Ajouter une nouvelle organisation"
      : "Devenir organisateur";

  const updateOrganizerField = <Key extends keyof OrganizerProfileForm>(
    field: Key,
    value: OrganizerProfileForm[Key],
  ) => {
    setOrganizerForm((currentForm) => ({ ...currentForm, [field]: value }));
    setOrganizerErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
    setServerError(null);
  };

  const updateOrganizationField = <Key extends keyof OrganizationForm>(
    field: Key,
    value: OrganizationForm[Key],
  ) => {
    setOrganizationForm((currentForm) => ({ ...currentForm, [field]: value }));
    setOrganizationErrors((currentErrors) => ({
      ...currentErrors,
      [field]: undefined,
    }));
    setServerError(null);
  };

  const toggleCategory = (category: OrganizationCategoryName) => {
    updateOrganizationField(
      "categories",
      organizationForm.categories.includes(category)
        ? organizationForm.categories.filter((item) => item !== category)
        : [...organizationForm.categories, category],
    );
  };

  const cancelSetup = () => {
    navigate(ROUTES.USER.PROFILE);
  };

  const goToOrganizationStep = () => {
    const errors = validateOrganizerProfileForm(organizerForm);
    setOrganizerErrors(errors);
    setServerError(null);

    if (Object.keys(errors).length === 0) {
      setStep(1);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    if (!currentUser || !userId) {
      setServerError("Compte utilisateur introuvable");
      return;
    }

    const errors = validateOrganizationForm(organizationForm, organizations);
    setOrganizationErrors(errors);

    if (Object.keys(errors).length > 0) return;
    setIsSubmitting(true);

    const organizationResult = await organizationsApi.create({
      name: organizationForm.name.trim(),
      contact_email: organizationForm.contact_email.trim(),
      description: organizationForm.description.trim(),
      website: organizationForm.website.trim() || null,
      address: organizationForm.address.trim(),
      city: organizationForm.city.trim(),
      postal_code: organizationForm.postal_code.trim(),
      logo: organizationForm.logo.trim() || null,
      contact_phone_number: organizationForm.contact_phone_number.trim() || null,
      siret: organizationForm.siret.trim() || null,
      is_active: false,
      is_verified: false,
      category_slugs: organizationForm.categories,
    });

    if (!organizationResult.ok) {
      setServerError(organizationResult.error.message);
      setIsSubmitting(false);
      return;
    }

    upsertOrganizations([organizationResult.data]);

    const memberResult = await organizationsApi.addMember(organizationResult.data.id, {
      user_id: userId,
      job_role: organizerForm.job_role.trim() || null,
    });

    if (!memberResult.ok) {
      setServerError(memberResult.error.message);
      setIsSubmitting(false);
      return;
    }

    upsertOrganizers([memberResult.data]);
    toast.success("Organisation créée et rattachée à votre compte");
    setIsSubmitting(false);
    navigate(ROUTES.USER.ORGANIZATIONS, { replace: true });
  };

  if (!currentUser || !userId) {
    return (
      <section className="organization-setup">
        <h1>{title}</h1>
        <ErrorMessage message="Vous devez être connecté avec un compte utilisateur." />
      </section>
    );
  }

  return (
    <section className="organization-setup">
      <div className="organization-setup__header">
        <h1>{title}</h1>
      </div>

      <ol className="form-stepper" aria-label="Progression du formulaire">
        <li className={step === 0 ? "is-active" : ""}>
          <span>1</span>
          Profil organisateur
        </li>
        <li className={step === 1 ? "is-active" : ""}>
          <span>2</span>
          Organization
        </li>
      </ol>

      {step === 0 ? (
        <form className="organization-form" onSubmit={(event) => event.preventDefault()}>
          <fieldset className="auth-form-section">
            <legend>Informations de l'organisateur</legend>
            <FormField
              label="Fonction"
              htmlFor="organizer-job-role"
              error={organizerErrors.job_role}
            >
              <Input
                id="organizer-job-role"
                autoComplete="organization-title"
                hasError={!!organizerErrors.job_role}
                placeholder="Responsable événementiel"
                value={organizerForm.job_role}
                onChange={(event) =>
                  updateOrganizerField("job_role", event.target.value)
                }
              />
            </FormField>
          </fieldset>

          {serverError && <ErrorMessage message={serverError} />}

          <ActionRow className="form-step-actions" align="center">
            <Button type="button" variant="secondary" onClick={cancelSetup}>
              Annuler
            </Button>
            <Button type="button" onClick={goToOrganizationStep}>
              Suivant
            </Button>
          </ActionRow>
        </form>
      ) : (
        <form className="organization-form" onSubmit={handleSubmit} noValidate>
          <OrganizationFields
            errors={organizationErrors}
            form={organizationForm}
            onCategoryToggle={toggleCategory}
            onFieldChange={updateOrganizationField}
          />

          {serverError && <ErrorMessage message={serverError} />}

          <ActionRow className="form-step-actions" align="center">
            <Button type="button" variant="secondary" onClick={cancelSetup}>
              Annuler
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              Précédent
            </Button>
            <Button type="submit" loading={isSubmitting} loadingLabel="Enregistrement...">
              Valider
            </Button>
          </ActionRow>
        </form>
      )}
    </section>
  );
}

export function OrganizationFields({
  errors,
  form,
  onCategoryToggle,
  onFieldChange,
}: {
  errors: OrganizationFormErrors;
  form: OrganizationForm;
  onCategoryToggle: (category: OrganizationCategoryName) => void;
  onFieldChange: <Key extends keyof OrganizationForm>(
    field: Key,
    value: OrganizationForm[Key],
  ) => void;
}) {
  return (
    <fieldset className="auth-form-section">
      <legend>Informations de l'organisation</legend>

      <div className="organization-form__grid">
        <FormField label="Nom" htmlFor="organization-name" error={errors.name}>
          <Input
            id="organization-name"
            autoComplete="organization"
            hasError={!!errors.name}
            value={form.name}
            onChange={(event) => onFieldChange("name", event.target.value)}
          />
        </FormField>

        <FormField
          label="Email de contact"
          htmlFor="organization-contact-email"
          error={errors.contact_email}
        >
          <Input
            id="organization-contact-email"
            autoComplete="email"
            hasError={!!errors.contact_email}
            type="email"
            value={form.contact_email}
            onChange={(event) =>
              onFieldChange("contact_email", event.target.value)
            }
          />
        </FormField>

        <FormField
          className="organization-form__wide"
          label="Description"
          htmlFor="organization-description"
          error={errors.description}
        >
          <Textarea
            id="organization-description"
            hasError={!!errors.description}
            rows={4}
            value={form.description}
            onChange={(event) => onFieldChange("description", event.target.value)}
          />
        </FormField>

        <FormField label="Site web" htmlFor="organization-website" error={errors.website}>
          <Input
            id="organization-website"
            hasError={!!errors.website}
            placeholder="https://example.fr"
            type="url"
            value={form.website}
            onChange={(event) => onFieldChange("website", event.target.value)}
          />
        </FormField>

        <ImageField
          className="organization-form__wide"
          id="organization-logo"
          label="Logo"
          value={form.logo}
          error={errors.logo}
          onChange={(value) => onFieldChange("logo", value)}
        />

        <AddressAutocomplete
          addressClassName="organization-form__wide"
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
          onChange={onFieldChange}
        />

        <FormField
          label="Telephone"
          htmlFor="organization-phone"
          error={errors.contact_phone_number}
        >
          <Input
            id="organization-phone"
            autoComplete="tel"
            hasError={!!errors.contact_phone_number}
            inputMode="tel"
            value={form.contact_phone_number}
            onChange={(event) =>
              onFieldChange("contact_phone_number", event.target.value)
            }
          />
        </FormField>

        <FormField label="SIRET" htmlFor="organization-siret" error={errors.siret}>
          <Input
            id="organization-siret"
            hasError={!!errors.siret}
            inputMode="numeric"
            value={form.siret}
            onChange={(event) => onFieldChange("siret", event.target.value)}
          />
        </FormField>

        <div className="organization-form__wide">
          <CheckboxGroup
            error={errors.categories}
            label="Categories"
            labelId="organization-categories"
          >
            {CATEGORIES.map((category) => (
              <Checkbox
                checked={form.categories.includes(category)}
                key={category}
                label={category}
                onChange={() => onCategoryToggle(category)}
              />
            ))}
          </CheckboxGroup>
        </div>
      </div>
    </fieldset>
  );
}
