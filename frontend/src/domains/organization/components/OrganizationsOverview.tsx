import { useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import EmptyState from "../../../shared/components/feedback/EmptyState";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import ConfirmDialog from "../../../shared/components/forms/ConfirmDialog";
import FormModal from "../../../shared/components/forms/FormModal";
import { FormModalLink } from "../../../shared/components/forms/FormModalLink";
import ActionRow from "../../../shared/components/layout/ActionRow";
import Button from "../../../shared/components/ui/Button";
import StatusBadge from "../../../shared/components/ui/StatusBadge";
import { ROUTES } from "../../../shared/constants/routes";
import useDataStore from "../../../shared/store/dataStore";
import useAuthStore from "../../auth/store/authStore";
import { organizationsApi } from "../api/organizations.api";
import type { Organization } from "../types/organization";
import { getCurrentUserOrganizationMemberships } from "../utils/organizerAccess";
import { OrganizationFields } from "./OrganizationSetupFlow";
import {
  getOrganizationStatus,
  toOrganizationForm,
  validateOrganizationForm,
  type OrganizationForm,
  type OrganizationFormErrors,
} from "../utils/organizationWorkflow";
import type { OrganizationCategoryName } from "../types/organization-categories";

export default function OrganizationsPage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const organizations = useDataStore((s) => s.organizations);
  const organizers = useDataStore((s) => s.organizers);
  const events = useDataStore((s) => s.events);
  const updateOrganization = useDataStore((s) => s.updateOrganization);
  const deleteOrganization = useDataStore((s) => s.deleteOrganization);
  const [editingOrganizationId, setEditingOrganizationId] = useState<number | null>(
    null,
  );
  const [organizationForm, setOrganizationForm] = useState<OrganizationForm | null>(
    null,
  );
  const [organizationErrors, setOrganizationErrors] =
    useState<OrganizationFormErrors>({});
  const [pendingDeleteOrganization, setPendingDeleteOrganization] =
    useState<Organization | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const userOrganizations = getCurrentUserOrganizationMemberships(
    currentUser,
    organizers,
    organizations,
  ).map(({ organization }) => organization);

  const closeOrganizationModal = () => {
    setEditingOrganizationId(null);
    setOrganizationForm(null);
    setOrganizationErrors({});
    setModalError(null);
  };

  const startOrganizationEdit = (organization: Organization) => {
    setEditingOrganizationId(organization.id);
    setOrganizationForm(toOrganizationForm(organization));
    setOrganizationErrors({});
    setModalError(null);
  };

  const updateOrganizationField = <Key extends keyof OrganizationForm>(
    field: Key,
    value: OrganizationForm[Key],
  ) => {
    setOrganizationForm((currentForm) =>
      currentForm ? { ...currentForm, [field]: value } : currentForm,
    );
    setOrganizationErrors((currentErrors) => ({
      ...currentErrors,
      [field]: undefined,
    }));
    setModalError(null);
  };

  const toggleOrganizationCategory = (category: OrganizationCategoryName) => {
    if (!organizationForm) return;

    updateOrganizationField(
      "categories",
      organizationForm.categories.includes(category)
        ? organizationForm.categories.filter((item) => item !== category)
        : [...organizationForm.categories, category],
    );
  };

  const saveOrganization = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();

    if (!organizationForm || editingOrganizationId === null) return;

    const errors = validateOrganizationForm(
      organizationForm,
      organizations,
      editingOrganizationId,
    );
    setOrganizationErrors(errors);
    setModalError(null);

    if (Object.keys(errors).length > 0) return;

    const payload = {
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
      category_slugs: organizationForm.categories,
    };

    const result = await organizationsApi.update(editingOrganizationId, payload);

    if (!result.ok) {
      setModalError(result.error.message);
      return;
    }

    updateOrganization(editingOrganizationId, result.data);

    toast.success("Organisation mise à jour");
    closeOrganizationModal();
  };

  const confirmDeleteOrganization = async () => {
    if (!pendingDeleteOrganization) return;

    const result = await organizationsApi.remove(pendingDeleteOrganization.id);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    deleteOrganization(pendingDeleteOrganization.id);
    toast.success("Organisation supprimée");
    setPendingDeleteOrganization(null);
  };

  return (
    <section className="organizations-page">
      <FormModal
        ariaLabel="Modifier une organisation"
        open={organizationForm !== null && editingOrganizationId !== null}
        size="lg"
        onClose={closeOrganizationModal}
      >
        {organizationForm && (
          <form
            className="organization-form organization-form--modal"
            onSubmit={saveOrganization}
            noValidate
          >
            <h2>Modifier l'organisation</h2>
            <OrganizationFields
              errors={organizationErrors}
              form={organizationForm}
              onCategoryToggle={toggleOrganizationCategory}
              onFieldChange={updateOrganizationField}
            />
            {modalError && <ErrorMessage message={modalError} />}
            <ActionRow className="form-step-actions" align="center">
              <Button type="submit">Valider</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={closeOrganizationModal}
              >
                Annuler
              </Button>
            </ActionRow>
          </form>
        )}
      </FormModal>

      <ConfirmDialog
        confirmLabel="Supprimer"
        message={
          pendingDeleteOrganization
            ? `Supprimer l'organisation "${pendingDeleteOrganization.name}" ?`
            : "Supprimer cette organisation ?"
        }
        open={pendingDeleteOrganization !== null}
        title="Supprimer l'organisation"
        onCancel={() => setPendingDeleteOrganization(null)}
        onConfirm={() => {
          void confirmDeleteOrganization();
        }}
      />

      {userOrganizations.length === 0 ? (
        <EmptyState message="Aucune organisation rattachée à votre compte." />
      ) : (
        <div className="organization-card-grid">
          {userOrganizations.map((organization) => {
            const status = getOrganizationStatus(organization);
            const isValidated = organization.is_active && organization.is_verified;
            const eventCount = events.filter(
              (event) =>
                event.organization_id === organization.id && !event.deleted_at,
            ).length;

            return (
              <article
                className="organization-card"
                key={organization.id}
              >
                <div
                  className="organization-card__main"
                >
                  <div className="organization-card__logo">
                    {organization.logo ? (
                      <img src={organization.logo} alt={`Logo ${organization.name}`} />
                    ) : (
                      <span>{organization.name.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>

                  <div className="organization-card__body">
                    <div className="organization-card__title">
                      <h2>{organization.name}</h2>
                      <StatusBadge variant={status.variant}>{status.label}</StatusBadge>
                    </div>

                    {isValidated && (
                      <dl>
                        <div>
                          <dt>Catégorie</dt>
                          <dd className="organization-card__categories">
                            {organization.category_slugs.map((category) => (
                              <span key={category}>{category}</span>
                            ))}
                          </dd>
                        </div>
                        <div>
                          <dt>Événements</dt>
                          <dd>{eventCount}</dd>
                        </div>
                      </dl>
                    )}
                  </div>
                </div>

                {isValidated && (
                  <div className="organization-card__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => startOrganizationEdit(organization)}
                    >
                      Modifier
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setPendingDeleteOrganization(organization)}
                    >
                      Supprimer
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <ActionRow className="organization-card-actions" align="center">
        <FormModalLink
          className="btn btn--primary btn--sm organization-card-actions__create"
          to={ROUTES.USER.CREATE_ORGANIZATION}
        >
          Ajouter une nouvelle organisation
        </FormModalLink>
      </ActionRow>
    </section>
  );
}
