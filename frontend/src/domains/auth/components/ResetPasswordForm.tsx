import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import Button from "../../../shared/components/ui/Button";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import FormField from "../../../shared/components/ui/FormField";
import Input from "../../../shared/components/ui/Input";
import { ROUTES } from "../../../shared/constants/routes";
import { userApi } from "../../user/api/user.api";
import {
  resetPasswordSchema,
  type ResetPasswordFormData,
} from "../validations/passwordReset.schema";

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onTouched",
  });

  const onSubmit = async (data: ResetPasswordFormData) => {
    setLoading(true);
    setServerError(null);

    try {
      const result = await userApi.resetPassword(token ?? "", data.newPassword);

      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }

      toast.success("Mot de passe mis à jour");
      navigate(ROUTES.PUBLIC.LOGIN, { replace: true });
    } catch {
      setServerError("Erreur lors de la réinitialisation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <h1>Réinitialiser le mot de passe</h1>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
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
            autoComplete="new-password"
            hasError={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
        </FormField>

        {serverError && <ErrorMessage message={serverError} />}

        <Button type="submit" loading={loading}>
          Mettre a jour
        </Button>
      </form>

      <Link to={ROUTES.PUBLIC.LOGIN}>Retour à la connexion</Link>
    </div>
  );
}
