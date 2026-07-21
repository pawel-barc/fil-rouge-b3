import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";

import useAuthStore from "../../auth/store/authStore";
import EmptyState from "../../../shared/components/feedback/EmptyState";
import Button from "../../../shared/components/ui/Button";
import useDataStore from "../../../shared/store/dataStore";
import type { Notification, NotificationType } from "../types/notification";
import { userApi } from "../../user/api/user.api";

type Props = {
  markReadOnHover?: boolean;
  onNotificationOpen?: () => void;
  openOnClick?: boolean;
};

const normalizeComparable = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const shouldShowNotificationType = (
  type: NotificationType | undefined,
  title: string,
  message: string,
) => {
  if (!type || type.slug === "welcome_email") return false;

  const normalizedType = normalizeComparable(type.name);
  return (
    normalizedType !== normalizeComparable(title) &&
    normalizedType !== normalizeComparable(message)
  );
};

const getNotificationDisplayContent = (
  notification: Notification,
  type: NotificationType | undefined,
) => {
  switch (type?.slug) {
    case "organization_approved":
      return {
        title: "Organisation validée",
        message:
          "Votre organisation a été validée. Elle peut maintenant être visible sur Mappening.",
      };
    case "event_approved":
      return {
        title: "Événement validé",
        message: "Votre événement a été validé et publié sur Mappening.",
      };
    case "organization_rejected":
      return {
        title: "Organisation refusée",
        message: notification.message,
      };
    case "event_rejected":
      return {
        title: "Événement refusé",
        message: notification.message,
      };
    case "event_hidden":
      return {
        title: "Événement suspendu",
        message: notification.message,
      };
    case "event_deleted":
      return {
        title: "Événement supprimé",
        message: notification.message,
      };
    default:
      return {
        title: notification.title,
        message: notification.message,
      };
  }
};

export default function NotificationInbox({
  markReadOnHover = false,
  onNotificationOpen,
  openOnClick = false,
}: Props) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const notifications = useDataStore((s) => s.notifications);
  const notificationTypes = useDataStore((s) => s.notificationTypes);
  const upsertNotification = useDataStore((s) => s.upsertNotification);
  const markUserNotificationsAsRead = useDataStore(
    (s) => s.markUserNotificationsAsRead,
  );
  const navigate = useNavigate();
  const pendingReadIds = useRef(new Set<number>());
  const userId = currentUser?.user_id;

  const inAppNotifications = useMemo(
    () =>
      notifications
        .filter((notification) => notification.user_id === userId)
        .sort(
          (first, second) =>
            new Date(second.created_at).getTime() -
            new Date(first.created_at).getTime(),
        ),
    [notifications, userId],
  );
  const unreadCount = inAppNotifications.filter(
    (notification) => !notification.is_read,
  ).length;

  const getInternalActionPath = (actionUrl?: string | null) => {
    if (!actionUrl) return null;

    try {
      const url = new URL(actionUrl, window.location.origin);

      if (url.origin !== window.location.origin) return null;

      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  };

  const markNotificationAsRead = (notification: Notification) => {
    if (notification.is_read || pendingReadIds.current.has(notification.id)) {
      return;
    }

    pendingReadIds.current.add(notification.id);
    void userApi.markNotificationRead(notification.id).then((result) => {
      pendingReadIds.current.delete(notification.id);
      if (result.ok) {
        upsertNotification(result.data);
      }
    });
  };

  const openNotification = (notification: Notification) => {
    markNotificationAsRead(notification);

    if (!openOnClick) return;

    const actionPath = getInternalActionPath(notification.action_url);

    if (!actionPath) return;

    onNotificationOpen?.();
    navigate(actionPath);
  };

  const markAllAsRead = () => {
    if (!userId || unreadCount === 0) return;

    void userApi.markAllNotificationsRead().then((result) => {
      if (result.ok) {
        markUserNotificationsAsRead(userId);
      }
    });
  };

  return (
    <>
      {inAppNotifications.length === 0 ? (
        <EmptyState message="Aucune notification." />
      ) : (
        <>
          <div className="notification-center__toolbar">
            <span>
              {unreadCount} non lue{unreadCount > 1 ? "s" : ""}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={unreadCount === 0}
              onClick={markAllAsRead}
            >
              Tout marquer comme lu
            </Button>
          </div>
          <ul aria-label="Liste des notifications">
            {inAppNotifications.map((notification) => {
              const notificationType = notificationTypes.find(
                (type) => type.id === notification.notification_type_id,
              );
              const displayContent = getNotificationDisplayContent(
                notification,
                notificationType,
              );
              const showNotificationType = shouldShowNotificationType(
                notificationType,
                displayContent.title,
                displayContent.message,
              );

              return (
                <li
                  className={notification.is_read ? "" : "is-unread"}
                  key={notification.id}
                >
                  <div
                    className={`notification-center__item${
                      openOnClick ? " is-clickable" : ""
                    }`}
                    aria-label={`${displayContent.title}. ${
                      notification.is_read ? "Lue" : "Non lue"
                    }${openOnClick ? ". Ouvrir la notification" : ""}`}
                    onClick={
                      openOnClick ? () => openNotification(notification) : undefined
                    }
                    onMouseEnter={() => {
                      if (markReadOnHover) {
                        markNotificationAsRead(notification);
                      }
                    }}
                  >
                    <strong>{displayContent.title}</strong>
                    <span className="notification-center__message">
                      {displayContent.message}
                    </span>
                    {showNotificationType && notificationType && (
                      <small>{notificationType.name}</small>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
