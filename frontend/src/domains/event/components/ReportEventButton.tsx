import { useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Flag } from "lucide-react";
import { toast } from "react-toastify";

import useAuthStore from "../../auth/store/authStore";
import FormModal from "../../../shared/components/forms/FormModal";
import Button from "../../../shared/components/ui/Button";
import Textarea from "../../../shared/components/ui/Textarea";
import { staffApi } from "../../staff/api/staff.api";
import type { Role } from "../../user/types/user";
import type { Event } from "../types/event";

type Props = {
  event: Event;
};

const reportAllowedRoles = new Set<Role>(["user", "admin", "moderator"]);

export default function ReportEventButton({ event }: Props) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const statusId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [details, setDetails] = useState("");

  if (!currentUser) return null;

  const canReportRole = reportAllowedRoles.has(currentUser.role);
  const userId = canReportRole && currentUser.is_active ? currentUser.user_id : undefined;
  const unavailableMessage = !canReportRole
      ? "Seuls les comptes utilisateur et staff peuvent signaler un événement."
      : !currentUser.is_active
        ? "Votre compte doit être actif pour signaler un événement."
        : !currentUser.user_id
          ? "Profil utilisateur introuvable pour ce compte."
        : null;
  const isReportUnavailable = !!unavailableMessage;

  const stopCardActivation = (mouseEvent: MouseEvent) => {
    mouseEvent.stopPropagation();
  };

  const stopCardKeyboardActivation = (keyboardEvent: KeyboardEvent) => {
    keyboardEvent.stopPropagation();
  };

  const toggleReportForm = () => {
    if (unavailableMessage) {
      toast.info(unavailableMessage);
      return;
    }

    setIsOpen((value) => !value);
  };

  const submitReport = async () => {
    if (!userId || isSubmitting) return;

    const trimmedDetails = details.trim();

    if (trimmedDetails.length < 10) {
      toast.error("Ajoutez au moins 10 caracteres de detail");
      return;
    }

    setIsSubmitting(true);
    const result = await staffApi.createReport({
      target_type: "event",
      target_id: event.id,
      reporter_user_id: userId,
      reason: "Signalement utilisateur",
      details: trimmedDetails,
      priority: "medium",
    });

    setIsSubmitting(false);

    if (!result.ok) {
      toast.info(result.error.message);
      return;
    }

    setDetails("");
    setIsOpen(false);
    setIsSubmitting(false);
    toast.success("Signalement transmis à la modération");
  };

  return (
    <div
      className="event-report"
      onClick={stopCardActivation}
      onKeyDown={stopCardKeyboardActivation}
    >
      <Button
        className="event-report__trigger"
        type="button"
        size="sm"
        variant="secondary"
        icon={<Flag size={16} aria-hidden="true" />}
        disabled={isSubmitting || isReportUnavailable}
        loading={isSubmitting}
        loadingLabel="Envoi..."
        aria-label="Signaler cet événement"
        aria-describedby={unavailableMessage ? statusId : undefined}
        aria-expanded={isOpen}
        title={unavailableMessage ?? "Signaler cet événement"}
        onClick={toggleReportForm}
      >
      </Button>
      {unavailableMessage && (
        <p className="event-report__status" id={statusId}>
          {unavailableMessage}
        </p>
      )}

      {isOpen && !isReportUnavailable && (
        <FormModal
          ariaLabel={`Signaler ${event.title}`}
          open={isOpen}
          size="sm"
          onClose={() => setIsOpen(false)}
        >
          <form
            className="event-report__modal"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              submitReport();
            }}
          >
            <h2>Signaler un événement</h2>
            <label htmlFor={`report-details-${event.id}`}>
              Details du signalement
              <Textarea
                id={`report-details-${event.id}`}
                required
                rows={5}
                value={details}
                placeholder="Precisez le probleme"
                onChange={(eventChange) => setDetails(eventChange.target.value)}
              />
            </label>
            <div className="event-report__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsOpen(false)}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                loading={isSubmitting}
                loadingLabel="Envoi..."
              >
                Confirmer le signalement
              </Button>
            </div>
          </form>
        </FormModal>
      )}
    </div>
  );
}
