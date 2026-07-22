import type { ApiResult } from "../../../shared/api/api.types";
import { apiRequest } from "../../../shared/api/httpClient";
import type { Notification } from "../../notification/types/notification";
import type { NotificationType } from "../../notification/types/notification";
import type { EventCategoryName } from "../../event/types/event-categories";
import type { UserEventPreference } from "../types/user";
import {
  ROLE_IDS,
  type AuthenticatedUser,
  type Role,
} from "../types/user";

type BackendAuthUser = {
  id: number;
  account_id?: number;
  user_id?: number;
  email: string;
  login_email?: string;
  first_name: string;
  last_name: string;
  username?: string;
  role: string;
  account_type?: string;
  is_active: boolean;
  created_at?: string;
  organization_id?: number;
};

type BackendEventPreference = UserEventPreference & {
  category_slug?: EventCategoryName;
};

type UpdateProfilePayload = {
  username: string;
  login_email: string;
};

type ForgotPasswordResponse = {
  ok: true;
  message: string;
  reset_url?: string;
  resetLink?: string;
};

const normalizePreference = (
  preference: BackendEventPreference,
): UserEventPreference => ({
  id: preference.id,
  user_id: preference.user_id,
  event_category_id: preference.event_category_id,
  category_slug: preference.category_slug,
});

const normalizeNotification = (notification: Notification): Notification => ({
  ...notification,
  id: notification.id,
  user_id: notification.user_id,
  event_id: notification.event_id,
  organization_id: notification.organization_id,
});

const toApiList = <Item>(items: Item[] | null | undefined): Item[] =>
  Array.isArray(items) ? items : [];

const backendRoleToFrontendRole = (role: string): Role => {
  if (role === "admin") return "admin";
  if (role === "moderator") return "moderator";
  return "user";
};

const normalizeAuthUser = (user: BackendAuthUser): AuthenticatedUser => {
  const role = backendRoleToFrontendRole(user.role);
  const displayName = [user.first_name, user.last_name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const loginEmail = user.login_email ?? user.email;
  const accountId = user.account_id ?? user.id;

  return {
    id: accountId,
    account_id: accountId,
    login_email: loginEmail,
    role,
    role_id: ROLE_IDS[role],
    username: user.username || displayName || loginEmail.split("@")[0] || loginEmail,
    is_active: user.is_active,
    created_at: user.created_at,
    user_id: user.user_id ?? user.id,
    organization_id: user.organization_id,
    auth_source: "api",
  };
};

export const userApi = {
  async updateProfile(
    payload: UpdateProfilePayload,
  ): Promise<ApiResult<AuthenticatedUser>> {
    const result = await apiRequest<BackendAuthUser>("/api/auth/profile", {
      body: payload,
      method: "PATCH",
    });

    return result.ok ? { ok: true, data: normalizeAuthUser(result.data) } : result;
  },

  async requestPasswordReset(
    loginEmail: string,
  ): Promise<ApiResult<ForgotPasswordResponse>> {
    return apiRequest<ForgotPasswordResponse>("/api/auth/password/forgot", {
      body: { login_email: loginEmail },
      method: "POST",
    });
  },

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<ApiResult<null>> {
    const result = await apiRequest<{ ok: true }>("/api/auth/password/reset", {
      body: { token, new_password: newPassword },
      method: "POST",
    });

    return result.ok ? { ok: true, data: null } : result;
  },

  async listPreferences(): Promise<ApiResult<UserEventPreference[]>> {
    const result = await apiRequest<BackendEventPreference[] | null>(
      "/api/me/preferences",
    );
    return result.ok
      ? { ok: true, data: toApiList(result.data).map(normalizePreference) }
      : result;
  },

  async replacePreferences(
    categorySlugs: EventCategoryName[],
  ): Promise<ApiResult<UserEventPreference[]>> {
    const result = await apiRequest<BackendEventPreference[] | null>(
      "/api/me/preferences",
      {
        body: { category_slugs: categorySlugs },
        method: "PUT",
      },
    );
    return result.ok
      ? { ok: true, data: toApiList(result.data).map(normalizePreference) }
      : result;
  },

  async listNotifications(): Promise<ApiResult<Notification[]>> {
    const result = await apiRequest<Notification[] | null>("/api/me/notifications");
    return result.ok
      ? { ok: true, data: toApiList(result.data).map(normalizeNotification) }
      : result;
  },

  async listNotificationTypes(): Promise<ApiResult<NotificationType[]>> {
    return apiRequest<NotificationType[]>("/api/notification-types");
  },

  async markNotificationRead(
    notificationId: number,
  ): Promise<ApiResult<Notification>> {
    const result = await apiRequest<Notification>(
      `/api/me/notifications/${Math.abs(notificationId)}/read`,
      { method: "PATCH" },
    );
    return result.ok
      ? { ok: true, data: normalizeNotification(result.data) }
      : result;
  },

  markAllNotificationsRead(): Promise<ApiResult<{ ok: true }>> {
    return apiRequest<{ ok: true }>("/api/me/notifications/read", {
      method: "PATCH",
    });
  },
};
