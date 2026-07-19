import {
  createApiError,
  type ApiResult,
} from "../../../shared/api/api.types";
import { apiRequest } from "../../../shared/api/httpClient";
import { toBackendId } from "../../../shared/api/idMapping";
import { mediaApi } from "../../../shared/api/media.api";
import { isDataImageValue } from "../../../shared/utils/imageUpload";
import type { Organization } from "../types/organization";
import type { OrganizationCategoryName } from "../types/organization-categories";
import type { Organizer } from "../types/organizer";

export type OrganizationPayload = {
  account_id?: number;
  name: string;
  contact_email: string;
  description?: string | null;
  website?: string | null;
  address: string;
  city: string;
  postal_code: string;
  logo?: string | null;
  contact_phone_number?: string | null;
  siret?: string | null;
  is_verified?: boolean;
  is_active?: boolean;
  category_slugs: OrganizationCategoryName[];
};

export type OrganizationMemberPayload = {
  user_id: number;
  job_role?: string | null;
};

const ORGANIZATIONS_API_ENDPOINTS = {
  list: "/api/organizations",
  detail: (organizationId: number) =>
    `/api/organizations/${toBackendId(organizationId)}`,
  me: "/api/organizations/me",
  mine: "/api/me/organizations",
  categories: "/api/organization-categories",
  status: (organizationId: number) =>
    `/api/organizations/${toBackendId(organizationId)}/status`,
  verification: (organizationId: number) =>
    `/api/organizations/${toBackendId(organizationId)}/verification`,
  restore: (organizationId: number) =>
    `/api/organizations/${toBackendId(organizationId)}/restore`,
  members: (organizationId: number) =>
    `/api/organizations/${toBackendId(organizationId)}/members`,
  member: (organizationId: number, userId: number) =>
    `/api/organizations/${toBackendId(organizationId)}/members/${toBackendId(
      userId,
    )}`,
} as const;

const normalizeOrganizationFromApi = (organization: Organization): Organization => ({
  ...organization,
  id: organization.id,
  account_id: organization.account_id,
});

const normalizeOrganizerFromApi = (organizer: Organizer): Organizer => ({
  ...organizer,
  id: organizer.id,
  user_id: organizer.user_id,
  organization_id: organizer.organization_id,
});

const toApiList = <Item>(items: Item[] | null | undefined): Item[] =>
  Array.isArray(items) ? items : [];

const normalizePayload = async (
  payload: OrganizationPayload,
  organizationId?: number,
): Promise<ApiResult<OrganizationPayload>> => {
  const normalizedPayload: OrganizationPayload = {
    ...payload,
    account_id:
      payload.account_id !== undefined ? toBackendId(payload.account_id) : undefined,
    name: payload.name.trim(),
    contact_email: payload.contact_email.trim(),
    description: payload.description?.trim() || null,
    website: payload.website?.trim() || null,
    address: payload.address.trim(),
    city: payload.city.trim(),
    postal_code: payload.postal_code.trim(),
    logo: payload.logo?.trim() || null,
    contact_phone_number: payload.contact_phone_number?.trim() || null,
    siret: payload.siret?.trim() || null,
    category_slugs: Array.from(new Set(payload.category_slugs)),
  };

  if (!normalizedPayload.logo || !isDataImageValue(normalizedPayload.logo)) {
    return { ok: true, data: normalizedPayload };
  }

  const uploadResult = organizationId
    ? await mediaApi.replaceOrganizationLogo(organizationId, normalizedPayload.logo)
    : await mediaApi.uploadImageValue(normalizedPayload.logo, {
        entityType: "organization",
      });

  if (!uploadResult.ok) {
    return createApiError(uploadResult.error.code, uploadResult.error.message);
  }

  return {
    ok: true,
    data: {
      ...normalizedPayload,
      logo: uploadResult.data.url,
    },
  };
};

export const organizationsApi = {
  async list(query?: string): Promise<ApiResult<Organization[]>> {
    const params = new URLSearchParams();
    if (query?.trim()) {
      params.set("q", query.trim());
    }

    const result = await apiRequest<Organization[] | null>(
      `${ORGANIZATIONS_API_ENDPOINTS.list}${
        params.toString() ? `?${params.toString()}` : ""
      }`,
    );
    return result.ok
      ? { ok: true, data: toApiList(result.data).map(normalizeOrganizationFromApi) }
      : result;
  },

  async get(organizationId: number): Promise<ApiResult<Organization>> {
    const result = await apiRequest<Organization>(
      ORGANIZATIONS_API_ENDPOINTS.detail(organizationId),
    );
    return result.ok
      ? { ok: true, data: normalizeOrganizationFromApi(result.data) }
      : result;
  },

  async me(): Promise<ApiResult<Organization>> {
    const result = await apiRequest<Organization>(ORGANIZATIONS_API_ENDPOINTS.me);
    return result.ok
      ? { ok: true, data: normalizeOrganizationFromApi(result.data) }
      : result;
  },

  async mine(): Promise<ApiResult<Organization[]>> {
    const result = await apiRequest<Organization[] | null>(
      ORGANIZATIONS_API_ENDPOINTS.mine,
    );
    return result.ok
      ? { ok: true, data: toApiList(result.data).map(normalizeOrganizationFromApi) }
      : result;
  },

  async create(payload: OrganizationPayload): Promise<ApiResult<Organization>> {
    const normalizedPayload = await normalizePayload(payload);
    if (!normalizedPayload.ok) return normalizedPayload;

    const result = await apiRequest<Organization>(ORGANIZATIONS_API_ENDPOINTS.list, {
      body: normalizedPayload.data,
      method: "POST",
    });
    return result.ok
      ? { ok: true, data: normalizeOrganizationFromApi(result.data) }
      : result;
  },

  async update(
    organizationId: number,
    payload: OrganizationPayload,
  ): Promise<ApiResult<Organization>> {
    const normalizedPayload = await normalizePayload(payload, organizationId);
    if (!normalizedPayload.ok) return normalizedPayload;

    const result = await apiRequest<Organization>(
      ORGANIZATIONS_API_ENDPOINTS.detail(organizationId),
      {
        body: normalizedPayload.data,
        method: "PUT",
      },
    );
    return result.ok
      ? { ok: true, data: normalizeOrganizationFromApi(result.data) }
      : result;
  },

  remove(organizationId: number): Promise<ApiResult<null>> {
    return apiRequest<null>(ORGANIZATIONS_API_ENDPOINTS.detail(organizationId), {
      method: "DELETE",
    });
  },

  async restore(organizationId: number): Promise<ApiResult<Organization>> {
    const result = await apiRequest<Organization>(
      ORGANIZATIONS_API_ENDPOINTS.restore(organizationId),
      { method: "POST" },
    );
    return result.ok
      ? { ok: true, data: normalizeOrganizationFromApi(result.data) }
      : result;
  },

  async setStatus(
    organizationId: number,
    isActive: boolean,
  ): Promise<ApiResult<Organization>> {
    const result = await apiRequest<Organization>(
      ORGANIZATIONS_API_ENDPOINTS.status(organizationId),
      {
        body: { is_active: isActive },
        method: "PATCH",
      },
    );
    return result.ok
      ? { ok: true, data: normalizeOrganizationFromApi(result.data) }
      : result;
  },

  async setVerification(
    organizationId: number,
    isVerified: boolean,
  ): Promise<ApiResult<Organization>> {
    const result = await apiRequest<Organization>(
      ORGANIZATIONS_API_ENDPOINTS.verification(organizationId),
      {
        body: { is_verified: isVerified },
        method: "PATCH",
      },
    );
    return result.ok
      ? { ok: true, data: normalizeOrganizationFromApi(result.data) }
      : result;
  },

  async listMembers(organizationId: number): Promise<ApiResult<Organizer[]>> {
    const result = await apiRequest<Organizer[] | null>(
      ORGANIZATIONS_API_ENDPOINTS.members(organizationId),
    );
    return result.ok
      ? { ok: true, data: toApiList(result.data).map(normalizeOrganizerFromApi) }
      : result;
  },

  async addMember(
    organizationId: number,
    payload: OrganizationMemberPayload,
  ): Promise<ApiResult<Organizer>> {
    const result = await apiRequest<Organizer>(
      ORGANIZATIONS_API_ENDPOINTS.members(organizationId),
      {
        body: {
          ...payload,
          user_id: toBackendId(payload.user_id),
        },
        method: "POST",
      },
    );
    return result.ok
      ? { ok: true, data: normalizeOrganizerFromApi(result.data) }
      : result;
  },

  removeMember(organizationId: number, userId: number): Promise<ApiResult<null>> {
    return apiRequest<null>(
      ORGANIZATIONS_API_ENDPOINTS.member(organizationId, userId),
      { method: "DELETE" },
    );
  },
};
