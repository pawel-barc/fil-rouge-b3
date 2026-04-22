/**
 * Page de profil utilisateur.
 */

import useAuthStore from "../../auth/store/authStore";

export default function Profile() {
  const user = useAuthStore((s) => s.currentUser);

  return (
    <div>
      <h1>Bienvenue {user?.username}</h1>
      <p>Votre profil utilisateur</p>
    </div>
  );
}
