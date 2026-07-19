/**
 * Formulaire de connexion.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { FormModalLink } from "../../../shared/components/forms/FormModalLink";
import { loginSchema, type LoginFormData } from "../validations/login.schema";
import useAuthStore from "../store/authStore";
import { ROUTES } from "../../../shared/constants/routes";
import { authHttpApi } from "../api/authHttp.api";

import Input from "../../../shared/components/ui/Input";
import Button from "../../../shared/components/ui/Button";
import FormField from "../../../shared/components/ui/FormField";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";

export default function LoginForm() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: "onTouched",
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    setServerError(null);

    try {
      const result = await authHttpApi.login({
        email: data.login_email,
        password: data.password,
      });

      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }

      if (!login(result.data)) {
        setServerError("Ce compte est suspendu ou desactive.");
        return;
      }

      navigate(ROUTES.PUBLIC.HOME, { replace: true });
      toast.success("Connexion réussie");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className="auth-login-form"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div className="auth-login-form__fields">
        <FormField
          label="Email"
          htmlFor="email"
          error={errors.login_email?.message}
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="Votre email"
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
            autoComplete="current-password"
            placeholder="Votre mot de passe"
            hasError={!!errors.password}
            aria-describedby="password-error"
            {...register("password")}
          />
        </FormField>
      </div>

      {serverError && <ErrorMessage message={serverError} />}

      <Button type="submit" loading={loading} fullWidth>
        Se connecter
      </Button>

      <div className="auth-login-form__links">
        <Link to={ROUTES.PUBLIC.REGISTER}>Créer un compte</Link>
        <FormModalLink to={ROUTES.PUBLIC.FORGOT_PASSWORD}>
          Mot de passe oublie ?
        </FormModalLink>
      </div>
    </form>
  );
}
