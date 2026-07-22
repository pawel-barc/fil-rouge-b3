import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { EventCategoryName } from "../../event/types/event-categories";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import ActionRow from "../../../shared/components/layout/ActionRow";
import Button from "../../../shared/components/ui/Button";
import { ROUTES } from "../../../shared/constants/routes";
import useDataStore from "../../../shared/store/dataStore";
import useAuthStore from "../../auth/store/authStore";
import { userApi } from "../api/user.api";
import PreferencesGrid from "../components/PreferencesGrid";
import { useUserPreferences } from "../hooks/useUserPreferences";

export default function Onboarding() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.currentUser);
  const setUserEventPreferences = useDataStore(
    (s) => s.setUserEventPreferences,
  );
  const { preferences, toggle } = useUserPreferences([]);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = (category: EventCategoryName) => {
    setError(null);
    toggle(category);
  };

  const handleSave = async () => {
    if (!user?.user_id) return;

    if (preferences.length === 0) {
      setError("Sélectionnez au moins une préférence pour continuer.");
      return;
    }

    const result = await userApi.replacePreferences(preferences);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    setUserEventPreferences(user.user_id, result.data);
    navigate(ROUTES.PUBLIC.HOME);
  };

  return (
    <div className="auth-page auth-page--wide auth-page--register">
      <div className="auth-mobile-hero">
        <p className="auth-mobile-hero__brand">Mappening</p>
        <p>Trouvez les meilleurs événements autour de vous !</p>
      </div>

      <div className="auth-login-stack auth-register-stack">
        <div className="auth-register-stack__header">
          <h1>Choisis tes centres d'interet</h1>
        </div>

        <section className="auth-form-section">
          <h2>Préférences d'événements</h2>
          <PreferencesGrid selected={preferences} toggle={handleToggle} />
          {error && <ErrorMessage message={error} />}

          <ActionRow className="form-step-actions" align="center">
            <Button type="button" onClick={() => void handleSave()}>
              Continuer
            </Button>
          </ActionRow>
        </section>
      </div>
    </div>
  );
}
