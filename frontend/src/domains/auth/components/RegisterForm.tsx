import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import Button from "../../../shared/components/ui/Button";
import FormField from "../../../shared/components/ui/FormField";
import Input from "../../../shared/components/ui/Input";
import { ROUTES } from "../../../shared/constants/routes";
import { adminUsersApi } from "../../admin/api/adminUsers.api";
import type { Role } from "../../user/types/user";
import { authHttpApi } from "../api/authHttp.api";
import useAuthStore from "../store/authStore";
import {
  adminRegisterSchema,
  registerSchema,
  type RegisterFormData,
} from "../validations/register.schema";

type RegisterFormProps = {
  mode?: "public" | "admin";
  role?: Exclude<Role, "organization">;
  title?: string;
  submitLabel?: string;
  onCancel?: () => void;
  onSuccess?: () => void;
};

export default function RegisterForm({
  mode = "public",
  role = "user",
  title = "Inscription utilisateur",
  submitLabel,
  onCancel,
  onSuccess,
}: RegisterFormProps) {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isAdminMode = mode === "admin";
  const usernamePlaceholder = isAdminMode ? "Nom du compte" : "Votre nom";
  const emailPlaceholder = isAdminMode ? "Email du compte" : "Votre email";
  const passwordPlaceholder = isAdminMode
    ? "Mot de passe temporaire"
    : "Votre mot de passe";
  const confirmPasswordPlaceholder = isAdminMode
    ? "Confirmer le mot de passe temporaire"
    : "Confirmer votre mot de passe";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(isAdminMode ? adminRegisterSchema : registerSchema),
    mode: "onTouched",
  });

  const onSubmit = async (data: RegisterFormData) => {
    if (loading) return;

    const loginEmail = data.login_email.trim();
    const username = data.username.trim();

    setLoading(true);
    setServerError(null);

    try {
      if (mode === "admin") {
        const result = await adminUsersApi.create({
          email: loginEmail,
          password: data.password,
          first_name: username,
          last_name: "",
          role,
          is_active: true,
        });

        if (!result.ok) {
          setServerError(result.error.message);
          return;
        }

        toast.success("Compte créé avec succès");
        onSuccess?.();
        return;
      }

      const result = await authHttpApi.registerUser({
        login_email: loginEmail,
        username,
        password: data.password,
      });

      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }

      login(result.data);
      toast.success("Compte créé avec succès");
      navigate(ROUTES.PUBLIC.HOME, { replace: true });
    } catch {
      setServerError(
        mode === "admin"
          ? "Erreur lors de la creation du compte"
          : "Erreur lors de l'inscription",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={isAdminMode ? "admin-embedded-form" : undefined}>
      <h1 className={isAdminMode ? "admin-embedded-form__title" : undefined}>
        {title}
      </h1>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField
          label="Nom d'utilisateur"
          htmlFor="username"
          error={errors.username?.message}
        >
          <Input
            id="username"
            type="text"
            autoComplete="username"
            placeholder={usernamePlaceholder}
            hasError={!!errors.username}
            {...register("username")}
          />
        </FormField>

        <FormField
          label="Email de connexion"
          htmlFor="email"
          error={errors.login_email?.message}
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={emailPlaceholder}
            hasError={!!errors.login_email}
            aria-describedby="email-error"
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
            type="password"
            autoComplete="new-password"
            placeholder={passwordPlaceholder}
            hasError={!!errors.password}
            aria-describedby="password-error"
            {...register("password")}
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
            placeholder={confirmPasswordPlaceholder}
            hasError={!!errors.confirmPassword}
            aria-describedby="confirmPassword-error"
            {...register("confirmPassword")}
          />
        </FormField>

        {serverError && <ErrorMessage message={serverError} />}

        <div className="admin-actions">
          <Button type="submit" loading={loading}>
            {submitLabel ?? "Créer un compte utilisateur"}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={onCancel}
            >
              Annuler
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
