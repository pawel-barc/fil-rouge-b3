/**
 * Page d'historic utilisateur.
 */

import useAuthStore from "../../auth/store/authStore";

export default function History() {
  const user = useAuthStore((s) => s.currentUser);

  return (
    <div>
      <h1>Bienvenue {user?.username}</h1>
      <p>Votre Page d'historique</p>
    </div>
  );
}
