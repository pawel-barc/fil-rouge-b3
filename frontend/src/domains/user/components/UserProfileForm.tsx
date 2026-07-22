import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ConfirmDialog from "../../../shared/components/forms/ConfirmDialog";
import { ROUTES } from "../../../shared/constants/routes";
import { authHttpApi } from "../../auth/api/authHttp.api";
import useAuthStore from "../../auth/store/authStore";
import { userApi } from "../api/user.api";
import {
  profileSchema,
  type ProfileFormData,
} from "../validations/profile.schema";

import Input from "../../../shared/components/ui/Input";
import Button from "../../../shared/components/ui/Button";
import FormField from "../../../shared/components/ui/FormField";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";

export default function UserProfileForm() {
  const user = useAuthStore((s) => s.currentUser);
  const updateAuthUser = useAuthStore((s) => s.updateUser);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const canDeleteOwnAccount = user?.role === "user" && !!user.user_id;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    mode: "onTouched",
    defaultValues: {
      username: user?.username ?? "",
      login_email: user?.login_email ?? "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: ProfileFormData) => {
    setLoading(true);
    setServerError(null);

    try {
      if (!user) {
        setServerError("Utilisateur non trouve");
        return;
      }

      const loginEmail = data.login_email.trim();
      const username = data.username.trim();
      if (data.newPassword?.trim()) {
        setServerError(
          "Utilisez la page de changement de mot de passe pour modifier votre mot de passe.",
        );
        return;
      }

      const result = await userApi.updateProfile({
        login_email: loginEmail,
        username,
      });

      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }

      updateAuthUser({
        username: result.data.username,
        login_email: result.data.login_email,
      });
      reset({
        username: result.data.username,
        login_email: result.data.login_email,
        newPassword: "",
        confirmPassword: "",
      });
      toast.success("Profil mis à jour");
      return;

    } catch {
      setServerError("Erreur lors de la mise à jour du profil");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;

    const result = await authHttpApi.deleteAccount();
    if (!result.ok) {
      setServerError(result.error.message);
      setShowDeleteModal(false);
      return;
    }

    logout();
    toast.success("Compte supprimé");
    navigate(ROUTES.PUBLIC.LOGIN);
  };

  return (
    <div className="user-profile">
      <form className="user-profile-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField
          label="Nom d'utilisateur"
          htmlFor="username"
          error={errors.username?.message}
        >
          <Input
            id="username"
            type="text"
            placeholder="Votre nom"
            hasError={!!errors.username}
            {...register("username")}
          />
        </FormField>

        <FormField
          label="Email de connexion"
          htmlFor="login_email"
          error={errors.login_email?.message}
        >
          <Input
            id="login_email"
            type="email"
            placeholder="Votre email"
            autoComplete="email"
            hasError={!!errors.login_email}
            aria-describedby="login_email-error"
            {...register("login_email")}
          />
        </FormField>

        <FormField
          label="Nouveau mot de passe"
          htmlFor="newPassword"
          error={errors.newPassword?.message}
        >
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            hasError={!!errors.newPassword}
            aria-describedby="newPassword-error"
            {...register("newPassword")}
          />
        </FormField>

        <FormField
          label="Confirmer nouveau mot de passe"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
        >
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            hasError={!!errors.confirmPassword}
            aria-describedby="confirmPassword-error"
            {...register("confirmPassword")}
          />
        </FormField>

        {serverError && <ErrorMessage message={serverError} />}

        <Button type="submit" loading={loading}>
          Enregistrer les modifications
        </Button>
        {canDeleteOwnAccount && (
          <div className="user-profile-actions">
            <Button
              variant="danger"
              type="button"
              onClick={() => setShowDeleteModal(true)}
            >
              Supprimer mon compte
            </Button>
          </div>
        )}
      </form>

      <ConfirmDialog
        confirmLabel="Oui, supprimer"
        message="Cette action est définitive. Toutes vos données seront supprimées."
        open={showDeleteModal}
        title="Suppression du compte"
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteAccount}
      />
    </div>
  );
}
