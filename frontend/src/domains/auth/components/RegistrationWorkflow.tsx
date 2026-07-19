import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import ActionRow from "../../../shared/components/layout/ActionRow";
import Button from "../../../shared/components/ui/Button";
import FormField from "../../../shared/components/ui/FormField";
import Input from "../../../shared/components/ui/Input";
import { ROUTES } from "../../../shared/constants/routes";
import useDataStore from "../../../shared/store/dataStore";
import { OrganizationFields } from "../../organization/components/OrganizationSetupFlow";
import {
  emptyOrganizationForm,
  emptyOrganizerProfileForm,
  normalizeComparable,
  validateOrganizationForm,
  validateOrganizerProfileForm,
  type OrganizationForm,
  type OrganizationFormErrors,
  type OrganizerProfileErrors,
  type OrganizerProfileForm,
} from "../../organization/utils/organizationWorkflow";
import { organizationsApi } from "../../organization/api/organizations.api";
import PreferencesGrid from "../../user/components/PreferencesGrid";
import { userApi } from "../../user/api/user.api";
import { useUserPreferences } from "../../user/hooks/useUserPreferences";
import { authHttpApi } from "../api/authHttp.api";
import useAuthStore from "../store/authStore";
import { registerSchema, type RegisterFormData } from "../validations/register.schema";

type WorkflowStep =
  | "user-info"
  | "user-preferences"
  | "organizer-choice"
  | "organizer"
  | "organization";

const workflowSteps = [
  { key: "user-info", label: "Infos" },
  { key: "user-preferences", label: "Préférences" },
  { key: "organizer", label: "Organisateur" },
  { key: "organization", label: "Organisation" },
] as const;
const userWorkflowSteps = workflowSteps.slice(0, 2);
const ORGANIZATION_PENDING_MESSAGE =
  "Votre compte est en attente de validation. Une fois approuvé, vous pourrez gérer vos événements.";

const isActiveStep = (step: WorkflowStep, key: (typeof workflowSteps)[number]["key"]) => {
  if (step === "organizer-choice") return key === "user-preferences";

  return step === key;
};

export default function RegistrationWorkflow() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const accounts = useDataStore((s) => s.accounts);
  const users = useDataStore((s) => s.users);
  const organizations = useDataStore((s) => s.organizations);
  const upsertOrganizations = useDataStore((s) => s.upsertOrganizations);
  const upsertOrganizers = useDataStore((s) => s.upsertOrganizers);
  const setUserEventPreferences = useDataStore((s) => s.setUserEventPreferences);
  const { preferences, toggle } = useUserPreferences([]);
  const [step, setStep] = useState<WorkflowStep>("user-info");
  const [userDraft, setUserDraft] = useState<RegisterFormData | null>(null);
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
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const showWorkflowProgress = true;
  const [hasChosenOrganizerRegistration, setHasChosenOrganizerRegistration] =
    useState(false);
  const visibleWorkflowSteps = hasChosenOrganizerRegistration
    ? workflowSteps
    : userWorkflowSteps;
  const handleMobileBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate(ROUTES.PUBLIC.LOGIN);
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: "onTouched",
  });

  const validateUserUniqueness = (data: RegisterFormData) => {
    const loginEmail = data.login_email.trim();
    const username = data.username.trim();
    const existingAccount = accounts.find(
      (account) =>
        !account.deleted_at &&
        normalizeComparable(account.login_email) === normalizeComparable(loginEmail),
    );

    if (existingAccount) {
      return "Cet email est déjà utilisé";
    }

    const existingUsername = users.find(
      (user) =>
        !user.deleted_at &&
        normalizeComparable(user.username) === normalizeComparable(username),
    );

    if (existingUsername) {
      return "Ce nom d'utilisateur est déjà utilisé";
    }

    return null;
  };

  const completeUserOnlyRegistration = async () => {
    if (!userDraft) return;

    setLoading(true);
    setServerError(null);

    try {
      const duplicateError = validateUserUniqueness(userDraft);

      if (duplicateError) {
        setStep("user-info");
        setServerError(duplicateError);
        return;
      }

      const result = await authHttpApi.registerUser({
        login_email: userDraft.login_email.trim(),
        username: userDraft.username.trim(),
        password: userDraft.password,
        category_slugs: preferences,
      });

      if (!result.ok) {
        setStep("user-info");
        setServerError(result.error.message);
        return;
      }

      login(result.data);

      if (result.data.user_id) {
        const preferencesResult = await userApi.listPreferences();
        if (preferencesResult.ok) {
          setUserEventPreferences(result.data.user_id, preferencesResult.data);
        }
      }
      toast.success("Compte créé avec succès");
      navigate(ROUTES.PUBLIC.HOME, { replace: true });
    } finally {
      setLoading(false);
    }
  };

  const onUserInfoSubmit = (data: RegisterFormData) => {
    setServerError(null);
    setPreferencesError(null);

    const duplicateError = validateUserUniqueness(data);

    if (duplicateError) {
      setServerError(duplicateError);
      return;
    }

    setUserDraft(data);
    setStep("user-preferences");
  };

  const onUserPreferencesSubmit = () => {
    setServerError(null);

    if (preferences.length === 0) {
        setPreferencesError("Sélectionnez au moins une préférence d'événement.");
      return;
    }

    setPreferencesError(null);
    setStep("organizer-choice");
  };

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

  const toggleOrganizationCategory = (category: OrganizationForm["categories"][number]) => {
    updateOrganizationField(
      "categories",
      organizationForm.categories.includes(category)
        ? organizationForm.categories.filter((item) => item !== category)
        : [...organizationForm.categories, category],
    );
  };

  const goToOrganizationStep = () => {
    const errors = validateOrganizerProfileForm(organizerForm);
    setOrganizerErrors(errors);
    setServerError(null);

    if (Object.keys(errors).length === 0) {
      setStep("organization");
    }
  };

  const completeOrganizerRegistration = async () => {
    if (!userDraft) return;

    setLoading(true);
    setServerError(null);

    try {
      const duplicateError = validateUserUniqueness(userDraft);

      if (duplicateError) {
        setStep("user-info");
        setServerError(duplicateError);
        return;
      }

      const organizationValidationErrors = validateOrganizationForm(
        organizationForm,
        organizations,
      );
      setOrganizationErrors(organizationValidationErrors);

      if (Object.keys(organizationValidationErrors).length > 0) return;

      const organizationLogo = organizationForm.logo.trim();
      const organizationPayload = {
        name: organizationForm.name.trim(),
        contact_email: organizationForm.contact_email.trim(),
        description: organizationForm.description.trim(),
        website: organizationForm.website.trim(),
        address: organizationForm.address.trim(),
        city: organizationForm.city.trim(),
        postal_code: organizationForm.postal_code.trim(),
        contact_phone_number: organizationForm.contact_phone_number.trim(),
        siret: organizationForm.siret.trim(),
        category_slugs: organizationForm.categories,
      };

      const result = await authHttpApi.registerOrganization({
        login_email: userDraft.login_email.trim(),
        password: userDraft.password,
        member_name: userDraft.username.trim(),
        member_job_role: organizerForm.job_role.trim(),
        ...organizationPayload,
        logo: "",
      });

      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }

      let nextUser = result.data;
      const organizationResult = await organizationsApi.mine();

      if (organizationResult.ok) {
        let registeredOrganization =
          organizationResult.data.find(
            (organization) =>
              normalizeComparable(organization.name) ===
                normalizeComparable(organizationPayload.name) &&
              normalizeComparable(organization.contact_email) ===
                normalizeComparable(organizationPayload.contact_email),
          ) ?? organizationResult.data[0];

        if (!registeredOrganization) {
          login(nextUser);
          toast.info(ORGANIZATION_PENDING_MESSAGE);
          navigate(ROUTES.PUBLIC.HOME, { replace: true });
          return;
        }

        upsertOrganizations([registeredOrganization]);

        if (organizationLogo) {
          const logoResult = await organizationsApi.update(registeredOrganization.id, {
            ...organizationPayload,
            logo: organizationLogo,
            is_active: false,
            is_verified: false,
          });

          if (logoResult.ok) {
            registeredOrganization = logoResult.data;
            upsertOrganizations([registeredOrganization]);
          } else {
            toast.error(logoResult.error.message);
          }
        }

        const membersResult = await organizationsApi.listMembers(
          registeredOrganization.id,
        );
        if (membersResult.ok) {
          upsertOrganizers(membersResult.data);
        }

        nextUser = {
          ...nextUser,
          organization_id: registeredOrganization.id,
          is_verified: registeredOrganization.is_verified,
        };
      }

      login(nextUser);
      toast.info(ORGANIZATION_PENDING_MESSAGE);
      navigate(ROUTES.PUBLIC.HOME, { replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page auth-page--wide auth-page--register">
      <div className="auth-mobile-hero">
        <p className="auth-mobile-hero__brand">Mappening</p>
        <p>Trouvez les meilleurs événements autour de vous !</p>
      </div>

      <div className="auth-login-stack auth-register-stack">
        <div className="auth-register-stack__header">
          <Button
            aria-label="Retour"
            className="auth-register-stack__back"
            icon={<ArrowLeft size={18} aria-hidden="true" />}
            iconOnly
            size="icon"
            type="button"
            variant="secondary"
            onClick={handleMobileBack}
          >
            Retour
          </Button>
          <h1>Inscription</h1>
        </div>

        {showWorkflowProgress && (
          <ol className="form-stepper" aria-label="Progression du formulaire">
            {visibleWorkflowSteps.map((item, index) => (
              <li
                className={isActiveStep(step, item.key) ? "is-active" : ""}
                key={item.key}
              >
                <span>{index + 1}</span>
                {item.label}
              </li>
            ))}
          </ol>
        )}

        {step === "user-info" && (
          <form onSubmit={handleSubmit(onUserInfoSubmit)} noValidate>
            <fieldset className="auth-form-section">
              <legend>Informations utilisateur</legend>
              <FormField
                label="Nom d'utilisateur"
                htmlFor="username"
                error={errors.username?.message}
              >
                <Input
                  id="username"
                  autoComplete="username"
                  hasError={!!errors.username}
                  placeholder="Votre nom"
                  type="text"
                  {...register("username")}
                />
              </FormField>

              <FormField
                label="Email"
                htmlFor="email"
                error={errors.login_email?.message}
              >
                <Input
                  id="email"
                  autoComplete="email"
                  hasError={!!errors.login_email}
                  placeholder="Votre email"
                  type="email"
                  {...register("login_email")}
                />
              </FormField>

              <FormField
                label="Mot de passe"
                htmlFor="password"
                error={errors.password?.message}
              >
                <Input
                  id="password"
                  autoComplete="new-password"
                  hasError={!!errors.password}
                  placeholder="Votre mot de passe"
                  type="password"
                  {...register("password")}
                />
              </FormField>

              <FormField
                label="Confirmation du mot de passe"
                htmlFor="confirmPassword"
                error={errors.confirmPassword?.message}
              >
                <Input
                  id="confirmPassword"
                  autoComplete="new-password"
                  hasError={!!errors.confirmPassword}
                  placeholder="Confirmer votre mot de passe"
                  type="password"
                  {...register("confirmPassword")}
                />
              </FormField>
            </fieldset>

            {serverError && <ErrorMessage message={serverError} />}

            <ActionRow className="form-step-actions" align="center">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(ROUTES.PUBLIC.LOGIN)}
              >
                Annuler
              </Button>
              <Button type="submit">Continuer</Button>
            </ActionRow>
          </form>
        )}

        {step === "user-preferences" && (
          <section className="auth-form-section">
            <h2>Préférences d'événements</h2>
            <PreferencesGrid
              selected={preferences}
              toggle={(category) => {
                setPreferencesError(null);
                toggle(category);
              }}
            />
            {preferencesError && <ErrorMessage message={preferencesError} />}

            <ActionRow className="form-step-actions" align="center">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep("user-info")}
              >
                Precedent
              </Button>
              <Button type="button" onClick={onUserPreferencesSubmit}>
                Continuer
              </Button>
            </ActionRow>
          </section>
        )}

      {step === "organizer-choice" && (
        <section className="auth-choice" aria-labelledby="organizer-choice-title">
          <h2 id="organizer-choice-title">
            Souhaitez-vous également organiser des événements ?
          </h2>

          {serverError && <ErrorMessage message={serverError} />}

          <ActionRow className="form-step-actions" align="center">
            <Button
              disabled={loading}
              type="button"
              variant="secondary"
              onClick={() => setStep("user-preferences")}
            >
              Precedent
            </Button>
            <Button
              loading={loading}
              type="button"
              variant="secondary"
              onClick={completeUserOnlyRegistration}
            >
              Non
            </Button>
            <Button
              disabled={loading}
              type="button"
              onClick={() => {
                setHasChosenOrganizerRegistration(true);
                setStep("organizer");
              }}
            >
              Oui
            </Button>
          </ActionRow>
        </section>
      )}

      {step === "organizer" && (
        <form onSubmit={(event) => event.preventDefault()}>
          <fieldset className="auth-form-section">
            <legend>Informations de l'organisateur</legend>
            <FormField
              label="Fonction"
              htmlFor="registration-organizer-job-role"
              error={organizerErrors.job_role}
            >
              <Input
                id="registration-organizer-job-role"
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
            <Button type="button" variant="secondary" onClick={() => setStep("organizer-choice")}>
              Precedent
            </Button>
            <Button type="button" onClick={goToOrganizationStep}>
              Suivant
            </Button>
          </ActionRow>
        </form>
      )}

        {step === "organization" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            completeOrganizerRegistration();
          }}
          noValidate
        >
          <OrganizationFields
            errors={organizationErrors}
            form={organizationForm}
            onCategoryToggle={toggleOrganizationCategory}
            onFieldChange={updateOrganizationField}
          />

          {serverError && <ErrorMessage message={serverError} />}

          <ActionRow className="form-step-actions" align="center">
            <Button
              disabled={loading}
              type="button"
              variant="secondary"
              onClick={() => setStep("organizer")}
            >
              Precedent
            </Button>
            <Button loading={loading} type="submit">
              Créer le compte
            </Button>
          </ActionRow>
        </form>
        )}
      </div>
    </div>
  );
}
