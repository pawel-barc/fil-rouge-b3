import { WifiOff } from "lucide-react";

import { useOnlineStatus } from "../../hooks/useOnlineStatus";

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();

  // Le bandeau reste invisible tant que le navigateur est connecte.
  if (isOnline) return null;

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <WifiOff size={18} aria-hidden="true" />
      <span>Vous êtes hors ligne. Certaines données peuvent ne pas être à jour.</span>
    </div>
  );
}
