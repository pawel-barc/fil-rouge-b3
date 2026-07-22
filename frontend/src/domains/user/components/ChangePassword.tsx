import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { ROUTES } from "../../../shared/constants/routes";
import { authHttpApi } from "../../auth/api/authHttp.api";
import useAuthStore from "../../auth/store/authStore";
import {
  changePasswordSchema,
  type ChangePasswordFormData,
} from "../validations/changePassword.schema";

import Input from "../../../shared/components/ui/Input";
import Button from "../../../shared/components/ui/Button";
import FormField from "../../../shared/components/ui/FormField";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";

export default function ChangePassword() {
  const user = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onTouched",
    defaultValues: {
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: ChangePasswordFormData) => {
    setLoading(true);
    setServerError(null);

    try {
      if (!user) {
        setServerError("Utilisateur non trouve");
        return;
      }

      const result = await authHttpApi.changePassword({
        current_password: data.oldPassword,
        new_password: data.newPassword,
      });

      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }

      logout();
      toast.success("Mot de passe mis à jour. Reconnectez-vous.");
      navigate(ROUTES.PUBLIC.LOGIN);
    } catch {
      setServerError("Erreur lors du changement de mot de passe");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Changer le mot de passe</h1>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField
          label="Ancien mot de passe"
          htmlFor="oldPassword"
          error={errors.oldPassword?.message}
        >
          <Input
            id="oldPassword"
            type="password"
            hasError={!!errors.oldPassword}
            aria-describedby="oldPassword-error"
            {...register("oldPassword")}
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
            hasError={!!errors.newPassword}
            aria-describedby="newPassword-error"
            {...register("newPassword")}
          />
        </FormField>

        <FormField
          label="Confirmer mot de passe"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
        >
          <Input
            id="confirmPassword"
            type="password"
            hasError={!!errors.confirmPassword}
            aria-describedby="confirmPassword-error"
            {...register("confirmPassword")}
          />
        </FormField>

        {serverError && <ErrorMessage message={serverError} />}

        <Button type="submit" loading={loading}>
          Modifier le mot de passe
        </Button>
      </form>
    </div>
  );
}
