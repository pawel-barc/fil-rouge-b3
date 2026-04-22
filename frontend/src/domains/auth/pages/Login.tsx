/**
 * Page de connexion (version mock).
 * Permet de simuler l'authentification sans backend.
 */

import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import useAuthStore from "../store/authStore";
import { usersMock } from "../../auth/mocks/users.mock";

type FormData = {
  email: string;
  password: string;
};

export default function Login() {
  const { register, handleSubmit } = useForm<FormData>();
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const onSubmit = (data: FormData) => {
    const user = usersMock.find(
      (u) => u.email === data.email && u.password === data.password,
    );

    if (!user) {
      alert("Utilisateur introuvable");
      return;
    }

    login(user);

    // redirect selon rôle
    if (user.role === "admin") navigate("/admin");
    else if (user.role === "company") navigate("/company");
    else navigate("/profile");
  };

  return (
    <div>
      <h1>Connexion</h1>

      <form onSubmit={handleSubmit(onSubmit)}>
        <input
          type="email"
          placeholder="Email"
          {...register("email", { required: true })}
        />
        <input
          type="password"
          placeholder="Mot de passe"
          {...register("password", { required: true })}
        />

        <button type="submit">Se connecter</button>
      </form>
    </div>
  );
}
