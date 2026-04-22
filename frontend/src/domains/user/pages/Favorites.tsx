/**
 * Page de favoris utilisateur.
 */

import useAuthStore from "../../auth/store/authStore";

export default function Favorites() {
  const user = useAuthStore((s) => s.currentUser);

  return (
    <div>
      <h1>Bienvenue {user?.username}</h1>
      <p>Votre Page de favoris</p>
    </div>
  );
}
