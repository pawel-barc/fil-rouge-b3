import { useMemo, useState } from "react";
import { toast } from "react-toastify";

import EmptyState from "../../../shared/components/feedback/EmptyState";
import ErrorMessage from "../../../shared/components/feedback/ErrorMessage";
import Loader from "../../../shared/components/feedback/Loader";
import DecisionReasonModal from "../../../shared/components/forms/DecisionReasonModal";
import PanelStats from "../../../shared/components/layout/PanelStats";
import Toolbar from "../../../shared/components/layout/Toolbar";
import Button from "../../../shared/components/ui/Button";
import Input from "../../../shared/components/ui/Input";
import Select from "../../../shared/components/ui/Select";
import StatusBadge from "../../../shared/components/ui/StatusBadge";
import Textarea from "../../../shared/components/ui/Textarea";
import useAuthStore from "../../auth/store/authStore";
import type { Organization } from "../../organization/types/organization";
import type { Organizer } from "../../organization/types/organizer";
import type { Event } from "../../event/types/event";
import {
  formatEventDateRange,
  formatEventPrice,
  getTicketingHref,
  isEventSuspended,
} from "../../event/utils/event";
import type { Account, AccountSummary, User } from "../../user/types/user";
import { isAccountSuspended } from "../../user/types/user";
import type {
  ModerationAction,
  ModerationReport,
  ModerationTargetType,
} from "../types/moderation";
import useModeratorPermissions from "../hooks/useModeratorPermissions";
import useDataStore, {
  buildAccountSummaries,
} from "../../../shared/store/dataStore";
import { ROUTES } from "../../../shared/constants/routes";
import { accountRoleLabels } from "../../../shared/utils/account";
import useStaffSync from "../../staff/hooks/useStaffSync";

type ModeratorView = "dashboard" | "events" | "organizations" | "accounts" | "reports";

type ModeratorDashboardProps = {
  view?: ModeratorView;
};

type ModeratorDecisionRequest = {
  title: string;
  variant?: "primary" | "secondary" | "danger";
  onConfirm: (reason: string) => boolean | void | Promise<boolean | void>;
};

type OrganizerRow = {
  member: Organizer;
  user?: User;
  account?: Account;
  organization?: Organization;
};

type HandledReportStatus = Extract<
  ModerationReport["status"],
  "resolved" | "dismissed"
>;
type ModerationEventSort = "date-asc" | "date-desc" | "title-asc" | "city-asc";
type ModerationAccountSort = "name-asc" | "name-desc" | "email-asc";
type ModerationReportPriorityFilter = "all" | ModerationReport["priority"];
type ModerationReportSort = "newest" | "oldest" | "priority";

const finalEventActions: ModerationAction[] = [
  "event_rejected",
  "event_hidden",
  "event_deleted",
];

const finalOrganizationActions: ModerationAction[] = ["organization_rejected"];

const viewContent: Record<
  ModeratorView,
  {
    title: string;
    description: string;
  }
> = {
  dashboard: {
    title: "Panel modération",
    description:
      "Vue d'ensemble des validations, signalements et suspensions en cours.",
  },
  events: {
    title: "Modération des événements",
    description: "Validation, refus motivé, masquage et suppression d'événements.",
  },
  organizations: {
    title: "Modération des organisations",
    description:
      "Validation, comptes organisation et collaborateurs rattachés aux fiches.",
  },
  accounts: {
    title: "Modération des utilisateurs",
    description: "Suspension temporaire des comptes utilisateurs.",
  },
  reports: {
    title: "Signalements",
    description: "Suivi des signalements en attente, en cours et traités.",
  },
};

const reportStatusLabels: Record<ModerationReport["status"], string> = {
  open: "En attente",
  reviewing: "En cours de traitement",
  resolved: "Traité",
  dismissed: "Traité",
};

const reportPriorityLabels: Record<ModerationReport["priority"], string> = {
  low: "Priorité basse",
  medium: "Priorité moyenne",
  high: "Priorité haute",
};

const moderationActionLabels: Record<ModerationAction, string> = {
  account_admin_updated: "Compte modifié par administration",
  account_deleted: "Compte supprimé",
  account_restored: "Suspension de compte levée",
  event_admin_updated: "Événement modifié par administration",
  event_approved: "Événement validé",
  event_rejected: "Événement refusé",
  event_hidden: "Événement masqué",
  event_deleted: "Événement supprimé",
  event_restored: "Événement restauré",
  organization_admin_updated: "Organisation modifiée par administration",
  organization_approved: "Organisation validée",
  organization_deleted: "Organisation supprimée",
  organization_rejected: "Organisation refusée",
  account_suspended: "Compte suspendu",
  report_reviewing: "Signalement pris en charge",
  report_resolved: "Signalement confirmé",
  report_dismissed: "Signalement restauré",
};

const handledReportOutcomes: Record<
  HandledReportStatus,
  {
    action: ModerationAction;
    label: string;
    note: string;
    variant: "success" | "suspended";
  }
> = {
  resolved: {
    action: "report_resolved",
    label: "Suspendu",
    note:
      "Décision: signalement confirmé, la cible est marquée comme suspendue après vérification.",
    variant: "suspended",
  },
  dismissed: {
    action: "report_dismissed",
    label: "Restauré",
    note:
      "Décision: signalement classé, la cible est restaurée ou maintenue accessible.",
    variant: "success",
  },
};

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("fr-FR") : "Non renseigné";

const getTargetKey = (targetType: ModerationTargetType, targetId: number) =>
  `${targetType}-${targetId}`;

const isReasonMissing = (reason: string) => reason.trim().length < 5;

const isHandledReportStatus = (
  status: ModerationReport["status"],
): status is HandledReportStatus =>
  status === "resolved" || status === "dismissed";

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const getInitials = (value: string, fallback = "??") => {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return initials || fallback;
};

const getReportTime = (report: ModerationReport) =>
  new Date(report.resolved_at ?? report.created_at).getTime();

const reportPriorityRank: Record<ModerationReport["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const createSuspendedUntil = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

export default function ModeratorDashboard({
  view = "dashboard",
}: ModeratorDashboardProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const staffDataScope =
    view === "events"
      ? "moderator-events"
      : view === "organizations"
        ? "moderator-organizations"
        : view === "accounts"
          ? "moderator-accounts"
          : view === "reports"
            ? "moderator-reports"
            : "moderator-dashboard";
  const {
    applyAction: applyStaffAction,
    error: staffSyncError,
    isLoaded: isStaffLoaded,
    isLoading: isStaffLoading,
    refresh: refreshStaffData,
  } = useStaffSync(staffDataScope);
  const { can } = useModeratorPermissions();
  const accounts = useDataStore((s) => s.accounts);
  const users = useDataStore((s) => s.users);
  const organizations = useDataStore((s) => s.organizations);
  const organizers = useDataStore((s) => s.organizers);
  const events = useDataStore((s) => s.events);
  const staffSummary = useDataStore((s) => s.staffSummary);
  const moderationReports = useDataStore((s) => s.moderationReports);
  const moderationDecisions = useDataStore((s) => s.moderationDecisions);
  const [reportDecisionMessages, setReportDecisionMessages] = useState<
    Record<number, string>
  >({});
  const [suspensionDays, setSuspensionDays] = useState<Record<number, string>>({});
  const [eventSuspensionDays, setEventSuspensionDays] = useState<
    Record<number, string>
  >({});
  const [eventSearch, setEventSearch] = useState("");
  const [eventSort, setEventSort] = useState<ModerationEventSort>("date-asc");
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [organizationSort, setOrganizationSort] =
    useState<ModerationAccountSort>("name-asc");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountSort, setAccountSort] =
    useState<ModerationAccountSort>("name-asc");
  const [reportSearch, setReportSearch] = useState("");
  const [reportPriorityFilter, setReportPriorityFilter] =
    useState<ModerationReportPriorityFilter>("all");
  const [reportSort, setReportSort] =
    useState<ModerationReportSort>("newest");
  const [openedReportId, setOpenedReportId] = useState<number | null>(null);
  const [decisionRequest, setDecisionRequest] =
    useState<ModeratorDecisionRequest | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionReasonError, setDecisionReasonError] = useState("");
  const [isDecisionSubmitting, setIsDecisionSubmitting] = useState(false);

  const canFinalizeEvents = currentUser?.role === "admin";
  const accountSummaries = useMemo(
    () => buildAccountSummaries(accounts, users, organizations),
    [accounts, organizations, users],
  );

  const latestDecisionByTarget = useMemo(() => {
    const decisionMap = new Map<string, ModerationAction>();

    [...moderationDecisions]
      .sort(
        (first, second) =>
          new Date(second.created_at).getTime() -
          new Date(first.created_at).getTime(),
      )
      .forEach((decision) => {
        const key = getTargetKey(decision.target_type, decision.target_id);

        if (!decisionMap.has(key)) {
          decisionMap.set(key, decision.action);
        }
      });

    return decisionMap;
  }, [moderationDecisions]);

  const activeOrganizations = organizations.filter((organization) => !organization.deleted_at);
  const visibleEvents = events.filter((event) => !event.deleted_at);
  const pendingEvents = visibleEvents.filter((event) => {
    const latestDecision = latestDecisionByTarget.get(
      getTargetKey("event", event.id),
    );

    return (
      !event.is_active &&
      !isEventSuspended(event) &&
      (!latestDecision || !finalEventActions.includes(latestDecision))
    );
  });
  const publishedEvents = visibleEvents.filter(
    (event) => event.is_active && !isEventSuspended(event),
  );
  const suspendedEvents = visibleEvents.filter((event) =>
    isEventSuspended(event),
  );
  const pendingOrganizations = activeOrganizations.filter((organization) => {
    const latestDecision = latestDecisionByTarget.get(
      getTargetKey("organization", organization.id),
    );

    return (
      !organization.is_active &&
      (!latestDecision || !finalOrganizationActions.includes(latestDecision))
    );
  });
  const moderationAccounts = accountSummaries.filter(
    (account) => account.role === "user" || account.role === "organization",
  );
  const userAccounts = useMemo<AccountSummary[]>(() => {
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    return users
      .filter(
        (user) =>
          !user.deleted_at &&
          user.role !== "admin" &&
          user.role !== "moderator",
      )
      .map((user) => {
        const account = accountById.get(user.account_id);

        return {
          account_id: user.account_id,
          login_email: account?.login_email ?? user.username,
          role: user.role === "organization" ? "user" : user.role,
          role_id: user.role_id,
          display_name: user.username,
          is_active: account?.is_active ?? true,
          suspended_until: account?.suspended_until ?? null,
          suspension_reason: account?.suspension_reason ?? null,
          user_id: user.id,
        };
      });
  }, [accounts, users]);
  const organizationAccounts = moderationAccounts.filter(
    (account) => !!account.organization_id,
  );
  const organizerRows = useMemo<OrganizerRow[]>(() => {
    const organizationById = new Map(
      organizations.map((organization) => [organization.id, organization]),
    );
    const userById = new Map(users.map((user) => [user.id, user]));
    const accountById = new Map(accounts.map((account) => [account.id, account]));

    return organizers
      .filter((member) => !member.deleted_at)
      .map((member) => {
        const user = userById.get(member.user_id);

        return {
          member,
          user,
          account: user ? accountById.get(user.account_id) : undefined,
          organization: organizationById.get(member.organization_id),
        };
      });
  }, [accounts, organizations, organizers, users]);

  const updateReportDecisionMessage = (reportId: number, message: string) => {
    setReportDecisionMessages((currentMessages) => ({
      ...currentMessages,
      [reportId]: message,
    }));
  };

  const clearReportDecisionMessage = (reportId: number) => {
    setReportDecisionMessages((currentMessages) => {
      const nextMessages = { ...currentMessages };
      delete nextMessages[reportId];
      return nextMessages;
    });
  };

  const recordDecision = async (
    action: ModerationAction,
    targetType: ModerationTargetType,
    targetId: number,
    reason: string,
    options?: {
      reportId?: number;
      reportStatus?: ModerationReport["status"];
      suspendedUntil?: string;
    },
  ) => {
    const trimmedReason = reason.trim();

    if (!action.endsWith("_admin_updated")) {
      return applyStaffAction({
        action,
        target_type: targetType,
        target_id: targetId,
        reason: trimmedReason || "Decision staff",
        report_id: options?.reportId,
        report_status: options?.reportStatus,
        suspended_until: options?.suspendedUntil,
      });
    }

    return true;
  };

  const openDecisionModal = (request: ModeratorDecisionRequest) => {
    setDecisionRequest(request);
    setDecisionReason("");
    setDecisionReasonError("");
    setIsDecisionSubmitting(false);
  };

  const closeDecisionModal = () => {
    if (isDecisionSubmitting) return;

    setDecisionRequest(null);
    setDecisionReason("");
    setDecisionReasonError("");
  };

  const confirmDecision = async () => {
    if (!decisionRequest || isDecisionSubmitting) return;

    const reason = decisionReason.trim();

    if (isReasonMissing(reason)) {
      setDecisionReasonError("La justification est obligatoire.");
      return;
    }

    setIsDecisionSubmitting(true);
    try {
      const result = await decisionRequest.onConfirm(reason);
      if (result === false) return;

      setDecisionRequest(null);
      setDecisionReason("");
      setDecisionReasonError("");
    } finally {
      setIsDecisionSubmitting(false);
    }
  };

  const suspendReportedEvent = async (
    report: ModerationReport,
    moderatorMessage: string,
  ) => {
    if (report.target_type !== "event") return;

    const event = events.find(
      (item) => item.id === report.target_id && !item.deleted_at,
    );

    if (!event) return;

    const organization = activeOrganizations.find((item) => item.id === event.organization_id);

    if (!organization) return;

    const suspendedUntil = createSuspendedUntil(30);

    await recordDecision("event_hidden", "event", event.id, moderatorMessage, {
      suspendedUntil,
    });
  };

  const handleApproveOrganization = async (organization: Organization) => {
    const ok = await recordDecision(
      "organization_approved",
      "organization",
      organization.id,
      "Compte valide",
    );
    if (!ok) return false;
    toast.success(`${organization.name} est validée`);
    return true;
  };

  const handleRejectOrganization = async (organization: Organization, reason: string) => {
    const ok = await recordDecision(
      "organization_rejected",
      "organization",
      organization.id,
      reason,
    );
    if (!ok) return false;
    toast.success(`${organization.name} est refusée`);
    return true;
  };

  const handleApproveEvent = async (event: Event) => {
    const organization = activeOrganizations.find(
      (item) => item.id === event.organization_id && item.is_active,
    );

    if (!organization) {
      toast.error("Impossible de publier un événement d'une organisation inactive");
      return;
    }

    const ok = await recordDecision("event_approved", "event", event.id, "Événement validé");
    if (!ok) return false;
    toast.success(`${event.title} est publié`);
  };

  const handleRejectEvent = async (event: Event, reason: string) => {
    const organization = activeOrganizations.find((item) => item.id === event.organization_id);

    if (!organization) {
      toast.error("Organisation rattachée introuvable");
      return false;
    }

    const ok = await recordDecision("event_rejected", "event", event.id, reason);
    if (!ok) return false;
    toast.success(`${event.title} est refusé`);
  };

  const handleSuspendEvent = async (event: Event, reason: string) => {
    const daysValue = Number(eventSuspensionDays[event.id] ?? 7);

    if (!Number.isFinite(daysValue) || daysValue < 1 || daysValue > 90) {
      toast.error("La durée doit être comprise entre 1 et 90 jours");
      return false;
    }

    const suspendedUntil = createSuspendedUntil(daysValue);

    const ok = await recordDecision("event_hidden", "event", event.id, reason, {
      suspendedUntil,
    });
    if (!ok) return false;
    toast.success(`${event.title} est suspendu temporairement`);
  };

  const handleLiftEventSuspension = async (event: Event, reason: string) => {
    const ok = await recordDecision(
      "event_restored",
      "event",
      event.id,
      reason,
    );
    if (!ok) return false;
    toast.success(`Suspension levée pour ${event.title}`);
  };

  const handleDeleteEvent = async (event: Event, reason: string) => {
    const ok = await recordDecision("event_deleted", "event", event.id, reason);
    if (!ok) return false;
    toast.success(`${event.title} est supprimé`);
  };

  const handleSuspendAccountSummary = async (
    account: AccountSummary,
    reason: string,
    daysValue: number,
  ) => {
    const user = account.user_id
      ? users.find((item) => item.id === account.user_id && !item.deleted_at)
      : null;

    if (!user) {
      toast.error("Utilisateur rattache au compte introuvable");
      return false;
    }

    const suspendedUntil = createSuspendedUntil(daysValue);

    return recordDecision(
      "account_suspended",
      "account",
      account.account_id,
      reason,
      {
        suspendedUntil,
      },
    );
  };

  const handleSuspendAccount = async (account: AccountSummary, reason: string) => {
    const daysValue = Number(suspensionDays[account.account_id] ?? 7);

    if (!Number.isFinite(daysValue) || daysValue < 1 || daysValue > 90) {
      toast.error("La duree doit etre comprise entre 1 et 90 jours");
      return false;
    }

    if (!(await handleSuspendAccountSummary(account, reason, daysValue))) {
      return false;
    }

    toast.success(`${account.display_name} est suspendu temporairement`);
  };

  const handleLiftAccountSuspension = async (
    account: AccountSummary,
    reason: string,
  ) => {
    const ok = await recordDecision("account_restored", "account", account.account_id, reason);
    if (!ok) return false;
    toast.success(`Suspension levée pour ${account.display_name}`);
  };

  const applyResolvedReportTargetAction = async (
    report: ModerationReport,
    decisionMessage: string,
  ) => {
    if (report.target_type === "account") {
      const reportedAccount = accountSummaries.find(
        (account) => account.account_id === report.target_id,
      );

      if (reportedAccount) {
        await handleSuspendAccountSummary(reportedAccount, decisionMessage, 7);
      }

      return;
    }

    if (report.target_type === "organization") {
      const reportedOrganization = organizations.find(
        (organization) => organization.id === report.target_id && !organization.deleted_at,
      );

      if (!reportedOrganization) return;

      await recordDecision(
        "organization_rejected",
        "organization",
        reportedOrganization.id,
        decisionMessage,
      );

      const reportedOrganizationAccount = accountSummaries.find(
        (account) => account.organization_id === reportedOrganization.id,
      );

      if (reportedOrganizationAccount) {
        await handleSuspendAccountSummary(reportedOrganizationAccount, decisionMessage, 7);
      }
    }
  };

  const applyDismissedReportTargetAction = async (report: ModerationReport) => {
    if (report.target_type !== "event") return;

    const reportedEvent = events.find((event) => event.id === report.target_id);

    if (!reportedEvent) return;

    if (reportedEvent.deleted_at || isEventSuspended(reportedEvent)) {
      await recordDecision(
        "event_restored",
        "event",
        reportedEvent.id,
        "Signalement classe",
      );
    }
  };

  const handleReportStatus = async (
    report: ModerationReport,
    status: ModerationReport["status"],
    moderatorMessage = "",
  ) => {
    const handledOutcome = isHandledReportStatus(status)
      ? handledReportOutcomes[status]
      : null;
    const decisionMessage = moderatorMessage.trim();

    if (handledOutcome && isReasonMissing(decisionMessage)) {
      toast.error("Ajoutez un message de decision pour le signalement");
      return;
    }

    if (status === "reviewing") {
      setOpenedReportId(report.id);
      await recordDecision(
        "report_reviewing",
        report.target_type,
        report.target_id,
        "Prise en charge du signalement",
        {
          reportId: report.id,
          reportStatus: "reviewing",
        },
      );
    }

    if (handledOutcome) {
      await recordDecision(
        handledOutcome.action,
        report.target_type,
        report.target_id,
        decisionMessage,
        {
          reportId: report.id,
          reportStatus: status,
        },
      );
      clearReportDecisionMessage(report.id);
      setOpenedReportId((currentId) =>
        currentId === report.id ? null : currentId,
      );
    }

    if (status === "resolved") {
      await suspendReportedEvent(report, decisionMessage);
      await applyResolvedReportTargetAction(report, decisionMessage);
    }

    if (status === "dismissed") {
      await applyDismissedReportTargetAction(report);
    }

    toast.success("Signalement mis à jour");
  };

  const handleRestoreEvent = async (eventId: number, reason: string) => {
    const ok = await recordDecision(
      "event_restored",
      "event",
      eventId,
      reason,
    );
    if (!ok) return false;
    toast.success("Événement restauré en attente");
  };

  const handleDeleteEventPermanently = async (eventId: number, reason: string) => {
    const ok = await recordDecision("event_deleted", "event", eventId, reason);
    if (!ok) return false;
    toast.success("Événement supprimé définitivement");
  };

  const updateSuspensionDays = (accountId: number, value: string) => {
    setSuspensionDays((currentValues) => ({
      ...currentValues,
      [accountId]: value,
    }));
  };

  const updateEventSuspensionDays = (eventId: number, value: string) => {
    setEventSuspensionDays((currentValues) => ({
      ...currentValues,
      [eventId]: value,
    }));
  };

  const sortAccounts = (items: AccountSummary[], sort: ModerationAccountSort) =>
    [...items].sort((first, second) => {
      if (sort === "name-desc") {
        return second.display_name.localeCompare(first.display_name, "fr-FR");
      }

      if (sort === "email-asc") {
        return first.login_email.localeCompare(second.login_email, "fr-FR");
      }

      return first.display_name.localeCompare(second.display_name, "fr-FR");
    });

  const matchesAccountSearch = (account: AccountSummary, search: string) =>
    normalizeText(
      [
        account.display_name,
        account.login_email,
        account.role,
        account.suspension_reason ?? "",
      ].join(" "),
    ).includes(normalizeText(search));

  const matchesOrganizationAccountSearch = (
    account: AccountSummary,
    search: string,
  ) => {
    const organization = account.organization_id
      ? organizations.find((item) => item.id === account.organization_id)
      : null;

    return normalizeText(
      [
        account.display_name,
        account.login_email,
        organization?.contact_email ?? "",
      ].join(" "),
    ).includes(normalizeText(search));
  };

  const filterAccounts = (
    activeItems: AccountSummary[],
    suspendedItems: AccountSummary[],
    search: string,
    sort: ModerationAccountSort,
    matchesSearch: (account: AccountSummary, search: string) => boolean =
      matchesAccountSearch,
  ) => {
    const sourceItems = [...activeItems, ...suspendedItems];

    return sortAccounts(
      sourceItems.filter((account) => matchesSearch(account, search)),
      sort,
    );
  };

  const filteredEvents = (() => {
    const eventSearchText = normalizeText(eventSearch);
    const sourceEvents = [...pendingEvents, ...publishedEvents, ...suspendedEvents];

    return sourceEvents
      .filter((event) =>
        normalizeText(
          [
            event.title,
            event.description,
            event.city,
            event.postal_code,
            event.address,
            formatEventPrice(event.price),
            event.ticketing_link,
            event.suspension_reason ?? "",
            activeOrganizations.find((organization) => organization.id === event.organization_id)
              ?.name ?? "",
          ].join(" "),
        ).includes(eventSearchText),
      )
      .sort((firstEvent, secondEvent) => {
        if (eventSort === "date-desc") {
          return (
            new Date(secondEvent.start_date).getTime() -
            new Date(firstEvent.start_date).getTime()
          );
        }

        if (eventSort === "title-asc") {
          return firstEvent.title.localeCompare(secondEvent.title, "fr-FR");
        }

        if (eventSort === "city-asc") {
          return firstEvent.city.localeCompare(secondEvent.city, "fr-FR");
        }

        return (
          new Date(firstEvent.start_date).getTime() -
          new Date(secondEvent.start_date).getTime()
        );
      });
  })();
  const filteredPendingEvents = filteredEvents.filter(
    (event) => !event.is_active && !isEventSuspended(event),
  );
  const filteredPublishedEvents = filteredEvents.filter(
    (event) => event.is_active && !isEventSuspended(event),
  );
  const filteredSuspendedEvents = filteredEvents.filter((event) =>
    isEventSuspended(event),
  );

  const filteredOrganizations = (() => {
    const organizationSearchText = normalizeText(organizationSearch);
    const sourceOrganizations = pendingOrganizations;

    return [...sourceOrganizations]
      .filter((organization) =>
        normalizeText(
          [
            organization.name,
            organization.contact_email,
          ].join(" "),
        ).includes(organizationSearchText),
      )
      .sort((firstOrganization, secondOrganization) =>
        organizationSort === "name-desc"
          ? secondOrganization.name.localeCompare(firstOrganization.name, "fr-FR")
          : firstOrganization.name.localeCompare(secondOrganization.name, "fr-FR"),
      );
  })();
  const filteredOrganizationAccounts = filterAccounts(
    organizationAccounts,
    [],
    organizationSearch,
    organizationSort,
    matchesOrganizationAccountSearch,
  );
  const filteredOrganizers = organizerRows
    .filter(({ account, organization }) =>
      normalizeText(
        [
          account?.login_email ?? "",
          organization?.name ?? "",
          organization?.contact_email ?? "",
        ].join(" "),
      ).includes(normalizeText(organizationSearch)),
    )
    .sort((firstRow, secondRow) =>
      (firstRow.user?.username ?? "").localeCompare(
        secondRow.user?.username ?? "",
        "fr-FR",
      ),
    );

  const filteredUserAccounts = filterAccounts(
    userAccounts,
    [],
    accountSearch,
    accountSort,
  );
  const filteredActiveUserAccounts = filteredUserAccounts.filter(
    (account) => !isAccountSuspended(account),
  );
  const filteredSuspendedUserAccounts = filteredUserAccounts.filter((account) =>
    isAccountSuspended(account),
  );
  const filteredActiveOrganizationAccounts = filteredOrganizationAccounts.filter(
    (account) => !isAccountSuspended(account),
  );
  const filteredSuspendedOrganizationAccounts = filteredOrganizationAccounts.filter(
    (account) => isAccountSuspended(account),
  );

  const filteredReports = (() => {
    const reportSearchText = normalizeText(reportSearch);

    return moderationReports
      .filter((report) => {
        const matchesPriority =
          reportPriorityFilter === "all" ||
          report.priority === reportPriorityFilter;
        const targetLabel = getReportTargetLabel(
          report,
          events,
          organizations,
          accountSummaries,
        );

        return (
          matchesPriority &&
          normalizeText(
            [
              report.reason,
              report.details,
              report.status,
              report.priority,
              targetLabel,
              getUserName(report.reporter_user_id, users),
            ].join(" "),
          ).includes(reportSearchText)
        );
      })
      .sort((firstReport, secondReport) => {
        if (reportSort === "oldest") {
          return getReportTime(firstReport) - getReportTime(secondReport);
        }

        if (reportSort === "priority") {
          return (
            reportPriorityRank[firstReport.priority] -
            reportPriorityRank[secondReport.priority]
          );
        }

        return getReportTime(secondReport) - getReportTime(firstReport);
      });
  })();
  const filteredPendingReports = filteredReports.filter(
    (report) => report.status === "open",
  );
  const filteredReviewingReports = filteredReports.filter(
    (report) => report.status === "reviewing",
  );
  const filteredHandledReports = filteredReports.filter((report) =>
    isHandledReportStatus(report.status),
  );
  const filteredDecisions = moderationDecisions.filter((decision) =>
    normalizeText(
      [
        moderationActionLabels[decision.action],
        decision.reason,
        decision.target_type,
        getUserName(decision.moderator_user_id, users),
      ].join(" "),
    ).includes(normalizeText(reportSearch)),
  );

  const isEventsView = view === "events";
  const isOrganizationsView = view === "organizations";
  const isAccountsView = view === "accounts";
  const isReportsView = view === "reports";
  const currentViewContent = viewContent[view];
  const canReviewEvents = can("review_events");
  const canModerateEvents = can("moderate_events");
  const canReviewOrganizations = can("review_organizations");
  const canSuspendAccounts = can("suspend_accounts");
  const canManageReports = can("manage_reports");
  const canAccessCurrentView =
    view === "dashboard" ||
    (isEventsView && (canReviewEvents || canModerateEvents)) ||
    (isOrganizationsView && (canReviewOrganizations || canSuspendAccounts)) ||
    (isAccountsView && canSuspendAccounts) ||
    (isReportsView && canManageReports);
  const moderatorStats = [
    {
      label: "Utilisateurs",
      to: ROUTES.MODERATOR.DASHBOARD,
      value: staffSummary.accounts.total,
      detail: `${staffSummary.accounts.pending} en attente`,
      end: true,
    },
    {
      label: "Événements",
      to: ROUTES.MODERATOR.EVENTS,
      value: staffSummary.events.total,
      detail: `${staffSummary.events.pending} en attente`,
    },
    {
      label: "Organisations",
      to: ROUTES.MODERATOR.ORGANIZATIONS,
      value: staffSummary.organizations.total,
      detail: `${staffSummary.organizations.pending} en attente`,
    },
    {
      label: "Signalements",
      to: ROUTES.MODERATOR.REPORTS,
      value: staffSummary.reports.total,
      detail: `${staffSummary.reports.pending} en attente`,
    },
  ].filter((stat) => {
    if (stat.to === ROUTES.MODERATOR.EVENTS) {
      return canReviewEvents || canModerateEvents;
    }
    if (stat.to === ROUTES.MODERATOR.ORGANIZATIONS) {
      return canReviewOrganizations || canSuspendAccounts;
    }
    if (stat.to === ROUTES.MODERATOR.REPORTS) {
      return canManageReports;
    }

    return canSuspendAccounts;
  });

  if (staffSyncError && !isStaffLoaded) {
    return (
      <div className="admin-panel moderator-panel" aria-label={currentViewContent.title}>
        <section className="admin-section admin-section--wide">
          <ErrorMessage message={staffSyncError} />
          <Button type="button" onClick={() => void refreshStaffData()}>
            Recharger
          </Button>
        </section>
      </div>
    );
  }

  if (isStaffLoading || !isStaffLoaded) {
    return (
      <div className="admin-panel moderator-panel" aria-label={currentViewContent.title}>
        <section className="admin-section admin-section--wide">
          <Loader />
        </section>
      </div>
    );
  }

  return (
    <div className="admin-panel moderator-panel" aria-label={currentViewContent.title}>
      <PanelStats
        ariaLabel="Navigation moderation"
        className="panel-stats--moderation"
        stats={moderatorStats}
      />

      {!canAccessCurrentView && (
        <section className="admin-section admin-section--wide">
          <EmptyState message="Vous n'avez pas les permissions nécessaires pour cette vue." />
        </section>
      )}

      {isEventsView && (canReviewEvents || canModerateEvents) && (
        <Toolbar ariaLabel="Filtres des événements" className="admin-toolbar">
          <label>
            Rechercher
            <Input
              value={eventSearch}
              placeholder="Titre, ville, organisation..."
              onChange={(event) => setEventSearch(event.target.value)}
            />
          </label>
          <label>
            Trier par
            <Select
              value={eventSort}
              onChange={(event) =>
                setEventSort(event.target.value as ModerationEventSort)
              }
            >
              <option value="date-asc">Date croissante</option>
              <option value="date-desc">Date décroissante</option>
              <option value="title-asc">Titre A-Z</option>
              <option value="city-asc">Ville A-Z</option>
            </Select>
          </label>
        </Toolbar>
      )}

      {isEventsView && canReviewEvents && (
        <section className="admin-section admin-section--wide">
          <div className="admin-panel__heading admin-section__title">
            <h2>Événements en attente</h2>
            <span className="admin-count">{filteredPendingEvents.length}</span>
          </div>

          {filteredPendingEvents.length === 0 ? (
            <EmptyState message="Aucun événement en attente." />
          ) : (
            <div className="organization-review-list">
              {filteredPendingEvents.map((event) => (
                <EventModerationCard
                  event={event}
                  key={event.id}
                  approveLabel="Valider"
                  rejectLabel="Refuser"
                  onApprove={() => handleApproveEvent(event)}
                  onReject={() =>
                    openDecisionModal({
                      title: `Justifier le refus de ${event.title}`,
                      onConfirm: (reason) => handleRejectEvent(event, reason),
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {isEventsView && canModerateEvents && (
        <section className="admin-section admin-section--wide">
          <div className="admin-panel__heading admin-section__title">
            <h2>Événements publiés</h2>
            <span className="admin-count">{filteredPublishedEvents.length}</span>
          </div>

          {filteredPublishedEvents.length === 0 ? (
            <EmptyState message="Aucun événement publié." />
          ) : (
            <div className="organization-review-list">
              {filteredPublishedEvents.map((event) => (
                <PublishedEventModerationCard
                  event={event}
                  suspensionDays={eventSuspensionDays[event.id] ?? "7"}
                  key={event.id}
                  onSuspensionDaysChange={(value) =>
                    updateEventSuspensionDays(event.id, value)
                  }
                  onSuspend={() =>
                    openDecisionModal({
                      title: `Justifier la suspension de ${event.title}`,
                      variant: "secondary",
                      onConfirm: (reason) => handleSuspendEvent(event, reason),
                    })
                  }
                  onDelete={() =>
                    openDecisionModal({
                      title: `Justifier la suppression de ${event.title}`,
                      onConfirm: (reason) => handleDeleteEvent(event, reason),
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {isEventsView && canModerateEvents && (
        <section className="admin-section admin-section--wide">
          <div className="admin-panel__heading admin-section__title">
            <h2>Événements suspendus</h2>
            <span className="admin-count">{filteredSuspendedEvents.length}</span>
          </div>

          {filteredSuspendedEvents.length === 0 ? (
            <EmptyState message="Aucun événement suspendu." />
          ) : (
            <div className="organization-review-list">
              {filteredSuspendedEvents.map((event) => (
                <SuspendedEventModerationCard
                  event={event}
                  key={event.id}
                  onLift={() =>
                    openDecisionModal({
                      title: `Justifier la levee de suspension de ${event.title}`,
                      variant: "primary",
                      onConfirm: (reason) =>
                        handleLiftEventSuspension(event, reason),
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {isOrganizationsView && (canReviewOrganizations || canSuspendAccounts) && (
        <Toolbar ariaLabel="Filtres des organizations" className="admin-toolbar">
          <label>
            Rechercher
            <Input
              value={organizationSearch}
              placeholder="Organization ou email..."
              onChange={(event) => setOrganizationSearch(event.target.value)}
            />
          </label>
          <label>
            Trier par
            <Select
              value={organizationSort}
              onChange={(event) =>
                setOrganizationSort(event.target.value as ModerationAccountSort)
              }
            >
              <option value="name-asc">Nom A-Z</option>
              <option value="name-desc">Nom Z-A</option>
              <option value="email-asc">Email A-Z</option>
            </Select>
          </label>
        </Toolbar>
      )}

      {isOrganizationsView && canReviewOrganizations && (
        <section className="admin-section admin-section--wide">
          <div className="admin-panel__heading admin-section__title">
            <h2>Organisations en attente</h2>
            <span className="admin-count">{filteredOrganizations.length}</span>
          </div>

          {filteredOrganizations.length === 0 ? (
            <EmptyState message="Aucun compte organization en attente." />
          ) : (
            <div className="organization-review-list">
              {filteredOrganizations.map((organization) => (
                <OrganizationModerationCard
                  organization={organization}
                  key={organization.id}
                  onApprove={() => handleApproveOrganization(organization)}
                  onReject={() =>
                    openDecisionModal({
                      title: `Justifier le refus de ${organization.name}`,
                      onConfirm: (reason) =>
                        handleRejectOrganization(organization, reason),
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {isOrganizationsView && canSuspendAccounts && (
        <>
          <AccountSuspensionSection
            accounts={filteredActiveOrganizationAccounts}
            organizations={organizations}
            onDaysChange={updateSuspensionDays}
            onSuspend={(account) =>
              openDecisionModal({
                title: `Justifier la suspension de ${account.display_name}`,
                onConfirm: (reason) => handleSuspendAccount(account, reason),
              })
            }
            suspensionDays={suspensionDays}
            title="Liste des organizations"
          />

          <OrganizerAccountsSection rows={filteredOrganizers} />

          <SuspendedOrganizationsSection
            accounts={filteredSuspendedOrganizationAccounts}
            onLift={(account) =>
              openDecisionModal({
                title: `Justifier la levee de suspension de ${account.display_name}`,
                variant: "primary",
                onConfirm: (reason) =>
                  handleLiftAccountSuspension(account, reason),
              })
            }
          />
        </>
      )}

      {isAccountsView && canSuspendAccounts && (
        <Toolbar ariaLabel="Filtres des comptes" className="admin-toolbar">
          <label>
            Rechercher
            <Input
              value={accountSearch}
              placeholder="Nom, email, motif..."
              onChange={(event) => setAccountSearch(event.target.value)}
            />
          </label>
          <label>
            Trier par
            <Select
              value={accountSort}
              onChange={(event) =>
                setAccountSort(event.target.value as ModerationAccountSort)
              }
            >
              <option value="name-asc">Nom A-Z</option>
              <option value="name-desc">Nom Z-A</option>
              <option value="email-asc">Email A-Z</option>
            </Select>
          </label>
        </Toolbar>
      )}

      {isAccountsView && canSuspendAccounts && (
        <>
          <AccountSuspensionSection
            accounts={filteredActiveUserAccounts}
            onDaysChange={updateSuspensionDays}
            onSuspend={(account) =>
              openDecisionModal({
                title: `Justifier la suspension de ${account.display_name}`,
                onConfirm: (reason) => handleSuspendAccount(account, reason),
              })
            }
            suspensionDays={suspensionDays}
            title="Comptes utilisateurs"
          />

          <SuspendedAccountsSection
            organizationAccounts={[]}
            onLift={(account) =>
              openDecisionModal({
                title: `Justifier la levee de suspension de ${account.display_name}`,
                variant: "primary",
                onConfirm: (reason) =>
                  handleLiftAccountSuspension(account, reason),
              })
            }
            userAccounts={filteredSuspendedUserAccounts}
          />
        </>
      )}

      {isReportsView && canManageReports && (
        <Toolbar ariaLabel="Filtres des signalements" className="admin-toolbar">
          <label>
            Rechercher
            <Input
              value={reportSearch}
              placeholder="Motif, cible, utilisateur..."
              onChange={(event) => setReportSearch(event.target.value)}
            />
          </label>
          <label>
            Priorite
            <Select
              value={reportPriorityFilter}
              onChange={(event) =>
                setReportPriorityFilter(
                  event.target.value as ModerationReportPriorityFilter,
                )
              }
            >
              <option value="all">Toutes les priorites</option>
              <option value="high">Haute</option>
              <option value="medium">Moyenne</option>
              <option value="low">Basse</option>
            </Select>
          </label>
          <label>
            Trier par
            <Select
              value={reportSort}
              onChange={(event) =>
                setReportSort(event.target.value as ModerationReportSort)
              }
            >
              <option value="newest">Plus recents</option>
              <option value="oldest">Plus anciens</option>
              <option value="priority">Priorite</option>
            </Select>
          </label>
        </Toolbar>
      )}

      {isReportsView && canManageReports && (
        <section className="admin-section admin-section--wide">
          {filteredReports.length === 0 ? (
            <EmptyState message="Aucun signalement." />
          ) : (
            <div className="moderator-report-groups">
              <ReportGroup
                title="En attente"
                reports={filteredPendingReports}
                emptyText="Aucun signalement en attente."
                events={events}
                organizations={organizations}
                accountSummaries={accountSummaries}
                users={users}
                openedReportId={openedReportId}
                decisionMessages={reportDecisionMessages}
                onDecisionMessageChange={updateReportDecisionMessage}
                onToggleDetails={(reportId) =>
                  setOpenedReportId((currentId) =>
                    currentId === reportId ? null : reportId,
                  )
                }
                onStatusChange={handleReportStatus}
              />
              <ReportGroup
                title="En cours de traitement"
                reports={filteredReviewingReports}
                emptyText="Aucun signalement en cours de traitement."
                events={events}
                organizations={organizations}
                accountSummaries={accountSummaries}
                users={users}
                openedReportId={openedReportId}
                decisionMessages={reportDecisionMessages}
                onDecisionMessageChange={updateReportDecisionMessage}
                onToggleDetails={(reportId) =>
                  setOpenedReportId((currentId) =>
                    currentId === reportId ? null : reportId,
                  )
                }
                onStatusChange={handleReportStatus}
              />
              <ReportGroup
                title="Traite"
                reports={filteredHandledReports}
                emptyText="Aucun signalement traite."
                events={events}
                organizations={organizations}
                accountSummaries={accountSummaries}
                users={users}
                openedReportId={openedReportId}
                decisionMessages={reportDecisionMessages}
                onDecisionMessageChange={updateReportDecisionMessage}
                onToggleDetails={(reportId) =>
                  setOpenedReportId((currentId) =>
                    currentId === reportId ? null : reportId,
                  )
                }
                onStatusChange={handleReportStatus}
              />
            </div>
          )}
        </section>
      )}

      {isReportsView && canManageReports && (
        <section className="admin-section admin-section--wide">
          <div className="admin-panel__heading admin-section__title">
            <h2>Journal des decisions</h2>
            <span className="admin-count">{filteredDecisions.length}</span>
          </div>

          <div className="moderator-decision-list">
            {filteredDecisions.map((decision) => {
              const event =
                decision.target_type === "event"
                  ? events.find((item) => item.id === decision.target_id)
                  : undefined;

              return (
                <article className="moderator-decision" key={decision.id}>
                  <div>
                    <strong>{moderationActionLabels[decision.action]}</strong>
                    <p>{decision.reason}</p>
                    <small>
                      {formatDate(decision.created_at)} par{" "}
                      {getUserName(decision.moderator_user_id, users)}
                    </small>
                  </div>
                  {canFinalizeEvents && decision.target_type === "event" && event && (
                    <div className="admin-actions">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          openDecisionModal({
                            title: `Justifier la restauration de ${event.title}`,
                            variant: "secondary",
                            onConfirm: (reason) =>
                              handleRestoreEvent(decision.target_id, reason),
                          })
                        }
                      >
                        Restaurer
                      </Button>
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() =>
                          openDecisionModal({
                            title: `Justifier la suppression definitive de ${event.title}`,
                            onConfirm: (reason) =>
                              handleDeleteEventPermanently(
                                decision.target_id,
                                reason,
                              ),
                          })
                        }
                      >
                        Supprimer definitivement
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
      <DecisionReasonModal
        error={decisionReasonError}
        loading={isDecisionSubmitting}
        open={!!decisionRequest}
        reason={decisionReason}
        title={decisionRequest?.title ?? "Justifier la decision"}
        variant={decisionRequest?.variant}
        onCancel={closeDecisionModal}
        onConfirm={confirmDecision}
        onReasonChange={(reason) => {
          setDecisionReason(reason);
          if (decisionReasonError) setDecisionReasonError("");
        }}
      />
    </div>
  );
}

function EventModerationCard({
  event,
  approveLabel,
  rejectLabel,
  onApprove,
  onReject,
}: {
  event: Event;
  approveLabel: string;
  rejectLabel: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const ticketingHref = getTicketingHref(event.ticketing_link);

  return (
    <article className="organization-review">
      <StatusBadge className="organization-review__status" variant="pending">
        En attente
      </StatusBadge>
      <div className="organization-review__media">
        <img src={event.image} alt={`Visuel ${event.title}`} />
      </div>
      <div className="organization-review__content">
        <div className="organization-review__header">
          <div>
            <h3>{event.title}</h3>
            <p>{event.description}</p>
          </div>
        </div>
        <dl className="organization-review__details">
          <div>
            <dt>Horaires de l'événement</dt>
            <dd>{formatEventDateRange(event)}</dd>
          </div>
          <div>
            <dt>Adresse</dt>
            <dd>
              {event.address}, {event.city} {event.postal_code}
            </dd>
          </div>
          <div>
            <dt>Prix</dt>
            <dd>{formatEventPrice(event.price)}</dd>
          </div>
          {ticketingHref && (
            <div>
              <dt>Billetterie</dt>
              <dd>
                <a
                  href={ticketingHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ouvrir la billetterie
                </a>
              </dd>
            </div>
          )}
        </dl>
        <div className="admin-actions admin-actions--split">
          <Button type="button" onClick={onApprove}>
            {approveLabel}
          </Button>
          <Button variant="danger" type="button" onClick={onReject}>
            {rejectLabel}
          </Button>
        </div>
      </div>
    </article>
  );
}

function PublishedEventModerationCard({
  event,
  suspensionDays,
  onSuspensionDaysChange,
  onSuspend,
  onDelete,
}: {
  event: Event;
  suspensionDays: string;
  onSuspensionDaysChange: (value: string) => void;
  onSuspend: () => void;
  onDelete: () => void;
}) {
  const ticketingHref = getTicketingHref(event.ticketing_link);

  return (
    <article className="organization-review">
      <StatusBadge className="organization-review__status" variant="active">
        Publie
      </StatusBadge>
      <div className="organization-review__media">
        <img src={event.image} alt={`Visuel ${event.title}`} />
      </div>
      <div className="organization-review__content">
        <div className="organization-review__header">
          <div>
            <h3>{event.title}</h3>
            <p>{event.description}</p>
          </div>
        </div>
        <dl className="organization-review__details">
          <div>
            <dt>Horaires de l'événement</dt>
            <dd>{formatEventDateRange(event)}</dd>
          </div>
          <div>
            <dt>Prix</dt>
            <dd>{formatEventPrice(event.price)}</dd>
          </div>
          {ticketingHref && (
            <div>
              <dt>Billetterie</dt>
              <dd>
                <a
                  href={ticketingHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ouvrir la billetterie
                </a>
              </dd>
            </div>
          )}
        </dl>
        <div className="moderator-split-actions moderator-split-actions--event">
          <div className="moderator-event-suspension">
            <label className="moderator-days">
              Jours
              <Input
                min={1}
                max={90}
                type="number"
                value={suspensionDays}
                onChange={(event) =>
                  onSuspensionDaysChange(event.target.value)
                }
              />
            </label>
            <Button variant="secondary" type="button" onClick={onSuspend}>
              Suspendre
            </Button>
          </div>
          <Button variant="danger" type="button" onClick={onDelete}>
            Supprimer
          </Button>
        </div>
      </div>
    </article>
  );
}

function SuspendedEventModerationCard({
  event,
  onLift,
}: {
  event: Event;
  onLift: () => void;
}) {
  const ticketingHref = getTicketingHref(event.ticketing_link);

  return (
    <article className="organization-review">
      <StatusBadge className="organization-review__status" variant="suspended">
        Suspendu
      </StatusBadge>
      <div className="organization-review__media">
        <img src={event.image} alt={`Visuel ${event.title}`} />
      </div>
      <div className="organization-review__content">
        <div className="organization-review__header">
          <div>
            <h3>{event.title}</h3>
            <p>{event.description}</p>
          </div>
        </div>
        <dl className="organization-review__details">
          <div>
            <dt>Fin de suspension</dt>
            <dd>Jusqu'au {formatDate(event.suspended_until)}</dd>
          </div>
          <div>
            <dt>Motif</dt>
            <dd>{event.suspension_reason ?? "Motif non renseigne"}</dd>
          </div>
          <div>
            <dt>Prix</dt>
            <dd>{formatEventPrice(event.price)}</dd>
          </div>
          {ticketingHref && (
            <div>
              <dt>Billetterie</dt>
              <dd>
                <a
                  href={ticketingHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ouvrir la billetterie
                </a>
              </dd>
            </div>
          )}
        </dl>
        <div className="admin-actions admin-actions--split">
          <Button type="button" onClick={onLift}>
            Lever suspension
          </Button>
        </div>
      </div>
    </article>
  );
}

function OrganizationModerationCard({
  organization,
  onApprove,
  onReject,
}: {
  organization: Organization;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className="organization-review moderator-organization-card">
      <StatusBadge className="organization-review__status" variant="pending">
        En attente
      </StatusBadge>
      <div className="organization-review__media">
        {organization.logo ? (
          <img src={organization.logo} alt={`Logo ${organization.name}`} />
        ) : (
          <span aria-hidden="true">{getInitials(organization.name, "ORG")}</span>
        )}
      </div>
      <div className="organization-review__content">
        <div className="organization-review__header">
          <div>
            <h3>{organization.name}</h3>
            <p>{organization.description}</p>
          </div>
        </div>
        <dl className="organization-review__details">
          <div>
            <dt>Email</dt>
            <dd>{organization.contact_email}</dd>
          </div>
          <div>
            <dt>SIRET</dt>
            <dd>{organization.siret ?? "Non renseigne"}</dd>
          </div>
          <div>
            <dt>Adresse</dt>
            <dd>
              {organization.address}, {organization.city} {organization.postal_code}
            </dd>
          </div>
        </dl>
        <div className="admin-actions admin-actions--split">
          <Button type="button" onClick={onApprove}>
            Valider
          </Button>
          <Button variant="danger" type="button" onClick={onReject}>
            Refuser
          </Button>
        </div>
      </div>
    </article>
  );
}

function ReportGroup({
  title,
  reports,
  emptyText,
  events,
  organizations,
  accountSummaries,
  users,
  openedReportId,
  decisionMessages,
  onDecisionMessageChange,
  onToggleDetails,
  onStatusChange,
}: {
  title: string;
  reports: ModerationReport[];
  emptyText: string;
  events: Event[];
  organizations: Organization[];
  accountSummaries: AccountSummary[];
  users: User[];
  openedReportId: number | null;
  decisionMessages: Record<number, string>;
  onDecisionMessageChange: (reportId: number, message: string) => void;
  onToggleDetails: (reportId: number) => void;
  onStatusChange: (
    report: ModerationReport,
    status: ModerationReport["status"],
    moderatorMessage?: string,
  ) => void;
}) {
  return (
    <div className="moderator-report-group">
      <div className="moderator-report-group__title">
        <h3>{title}</h3>
        <span className="admin-count">{reports.length}</span>
      </div>

      {reports.length === 0 ? (
        <EmptyState message={emptyText} />
      ) : (
        <div className="organization-review-list">
          {reports.map((report) => (
            <ReportCard
              report={report}
              key={report.id}
              targetLabel={getReportTargetLabel(
                report,
                events,
                organizations,
                accountSummaries,
              )}
              reporterName={getUserName(report.reporter_user_id, users)}
              handlerName={
                report.handled_by_user_id
                  ? getUserName(report.handled_by_user_id, users)
                  : "Non assigne"
              }
              targetEvent={
                report.target_type === "event"
                  ? events.find((event) => event.id === report.target_id)
                  : undefined
              }
              targetOrganization={
                report.target_type === "organization"
                  ? organizations.find(
                      (organization) => organization.id === report.target_id,
                    )
                  : report.target_type === "event"
                    ? organizations.find(
                        (organization) =>
                          organization.id ===
                          events.find((event) => event.id === report.target_id)
                            ?.organization_id,
                      )
                    : undefined
              }
              targetAccount={
                report.target_type === "account"
                  ? accountSummaries.find(
                      (account) => account.account_id === report.target_id,
                    )
                  : undefined
              }
              isDetailOpen={openedReportId === report.id}
              decisionMessage={decisionMessages[report.id] ?? ""}
              onDecisionMessageChange={(message) =>
                onDecisionMessageChange(report.id, message)
              }
              onToggleDetails={() => onToggleDetails(report.id)}
              onReview={() => onStatusChange(report, "reviewing")}
              onResolve={(message) =>
                onStatusChange(report, "resolved", message)
              }
              onDismiss={(message) =>
                onStatusChange(report, "dismissed", message)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  report,
  targetLabel,
  targetEvent,
  targetOrganization,
  targetAccount,
  reporterName,
  handlerName,
  isDetailOpen,
  decisionMessage,
  onDecisionMessageChange,
  onToggleDetails,
  onReview,
  onResolve,
  onDismiss,
}: {
  report: ModerationReport;
  targetLabel: string;
  targetEvent?: Event;
  targetOrganization?: Organization;
  targetAccount?: AccountSummary;
  reporterName: string;
  handlerName: string;
  isDetailOpen: boolean;
  decisionMessage: string;
  onDecisionMessageChange: (message: string) => void;
  onToggleDetails: () => void;
  onReview: () => void;
  onResolve: (message: string) => void;
  onDismiss: (message: string) => void;
}) {
  const outcome = isHandledReportStatus(report.status)
    ? handledReportOutcomes[report.status]
    : null;
  const isHandled = outcome !== null;
  const decisionText = outcome
    ? report.resolution_note ?? outcome.note
    : null;

  return (
    <article className="organization-review moderator-report">
      <div className="organization-review__content">
        <div className="organization-review__header">
          <div>
            <h3>{report.reason}</h3>
            <p>{report.details}</p>
          </div>
          <div className="moderator-report__meta">
            <StatusBadge>
              {reportPriorityLabels[report.priority]}
            </StatusBadge>
            {outcome ? (
              <StatusBadge variant={outcome.variant}>
                {outcome.label}
              </StatusBadge>
            ) : null}
          </div>
        </div>
        <dl className="organization-review__details">
          <div>
            <dt>Cible</dt>
            <dd>{targetLabel}</dd>
          </div>
          <div>
            <dt>Statut</dt>
            <dd>{reportStatusLabels[report.status]}</dd>
          </div>
          <div>
            <dt>Signale par</dt>
            <dd>{reporterName}</dd>
          </div>
          <div>
            <dt>Assigne a</dt>
            <dd>{handlerName}</dd>
          </div>
        </dl>
        {decisionText ? (
          <div className="moderator-report__decision">
            <strong>Decision</strong>
            <p>{decisionText}</p>
          </div>
        ) : null}
        {!isHandled ? (
          report.status === "open" ? (
            <div className="admin-actions admin-actions--split moderator-report__actions">
              <Button variant="secondary" type="button" onClick={onReview}>
                Prendre en charge
              </Button>
            </div>
          ) : (
            <>
              <div className="admin-actions admin-actions--split moderator-report__actions">
                <Button variant="secondary" type="button" onClick={onToggleDetails}>
                  {isDetailOpen ? "Fermer la fiche" : "Ouvrir la fiche"}
                </Button>
              </div>
              {isDetailOpen && (
                <div className="moderator-report-detail">
                  <div className="moderator-report-detail__section">
                    <strong>Événement signalé</strong>
                    {targetEvent ? (
                      <dl className="organization-review__details">
                        <div>
                          <dt>Nom</dt>
                          <dd>{targetEvent.title}</dd>
                        </div>
                        <div>
                          <dt>Horaires</dt>
                          <dd>{formatEventDateRange(targetEvent)}</dd>
                        </div>
                        <div>
                          <dt>Adresse</dt>
                          <dd>
                            {targetEvent.address}, {targetEvent.postal_code}{" "}
                            {targetEvent.city}
                          </dd>
                        </div>
                        <div>
                          <dt>Prix</dt>
                          <dd>{formatEventPrice(targetEvent.price)}</dd>
                        </div>
                        <div>
                          <dt>Statut</dt>
                          <dd>
                            {isEventSuspended(targetEvent)
                              ? "Suspendu"
                              : targetEvent.is_active
                                ? "Publie"
                                : "En attente"}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <dl className="organization-review__details">
                        <div>
                          <dt>Cible</dt>
                          <dd>
                            {targetOrganization?.name ??
                              targetAccount?.display_name ??
                              targetLabel}
                          </dd>
                        </div>
                        <div>
                          <dt>Type</dt>
                          <dd>{report.target_type}</dd>
                        </div>
                      </dl>
                    )}
                  </div>

                  <div className="moderator-report-detail__section">
                    <strong>Signalement</strong>
                    <dl className="organization-review__details">
                      <div>
                        <dt>Motif</dt>
                        <dd>{report.reason}</dd>
                      </div>
                      <div>
                        <dt>Complement</dt>
                        <dd>{report.details}</dd>
                      </div>
                      <div>
                        <dt>Priorite</dt>
                        <dd>{reportPriorityLabels[report.priority]}</dd>
                      </div>
                      <div>
                        <dt>Signale par</dt>
                        <dd>{reporterName}</dd>
                      </div>
                    </dl>
                  </div>

                  <label className="moderator-reason moderator-report__message">
                    Message du moderateur
                    <Textarea
                      rows={3}
                      placeholder="Expliquez la decision qui sera transmise par notification"
                      value={decisionMessage}
                      onChange={(event) =>
                        onDecisionMessageChange(event.target.value)
                      }
                    />
                  </label>
                  <div className="admin-actions admin-actions--split moderator-report__actions">
                    <Button
                      type="button"
                      onClick={() => onResolve(decisionMessage)}
                    >
                      Suspendre
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => onDismiss(decisionMessage)}
                    >
                      Restaurer
                    </Button>
                  </div>
                </div>
              )}
            </>
          )
        ) : null}
      </div>
    </article>
  );
}

function AccountSuspensionSection({
  title,
  accounts,
  organizations = [],
  suspensionDays,
  onDaysChange,
  onSuspend,
}: {
  title: string;
  accounts: AccountSummary[];
  organizations?: Organization[];
  suspensionDays: Record<number, string>;
  onDaysChange: (accountId: number, value: string) => void;
  onSuspend: (account: AccountSummary) => void;
}) {
  return (
    <section className="admin-section admin-section--wide moderator-account-section">
      <div className="admin-panel__heading admin-section__title">
        <h2>{title}</h2>
        <span className="admin-count">{accounts.length}</span>
      </div>

      {accounts.length === 0 ? (
        <EmptyState message="Aucun compte a afficher." />
      ) : (
        <div
          className="admin-table admin-table--accounts moderator-account-table"
          role="table"
          aria-label={title}
        >
          <div role="rowgroup">
            {accounts.map((account) => {
              const organization = account.organization_id
                ? organizations.find((item) => item.id === account.organization_id)
                : null;
              const displayName = organization?.name ?? account.display_name;
              const displayEmail = organization?.contact_email ?? account.login_email;
              const isSuspended = isAccountSuspended(account);
              const canSuspend = account.is_active && !isSuspended;
              const status = isSuspended
                ? {
                    label: "Suspendu",
                    variant: "suspended" as const,
                  }
                : account.is_active
                  ? {
                      label: "Actif",
                      variant: "active" as const,
                    }
                  : {
                      label: "Inactif",
                      variant: "pending" as const,
                    };

              return (
                <div
                  className="admin-table__row moderator-account-row moderator-account-row--with-role"
                  role="row"
                  key={account.account_id}
                >
                  <div className="moderator-account-identity" role="cell">
                    {organization ? (
                      <div className="moderator-organization-thumb" aria-hidden="true">
                        {organization.logo ? (
                          <img src={organization.logo} alt="" />
                        ) : (
                          <span>{getInitials(organization.name, "ORG")}</span>
                        )}
                      </div>
                    ) : null}
                    <div>
                      <span>{displayName}</span>
                      <small>{displayEmail}</small>
                    </div>
                  </div>
                  <StatusBadge className="moderator-account-role" role="cell">
                    {organization ? "Organisation" : accountRoleLabels[account.role]}
                  </StatusBadge>
                  <StatusBadge variant={status.variant} role="cell">
                    {status.label}
                  </StatusBadge>
                  <label className="moderator-days" role="cell">
                    Jours
                    <Input
                      disabled={!canSuspend}
                      min={1}
                      max={90}
                      type="number"
                      value={suspensionDays[account.account_id] ?? "7"}
                      onChange={(event) =>
                        onDaysChange(account.account_id, event.target.value)
                      }
                    />
                  </label>
                  <div role="cell">
                    <Button
                      disabled={!canSuspend}
                      variant="danger"
                      type="button"
                      onClick={() => onSuspend(account)}
                    >
                      Suspendre
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function OrganizerAccountsSection({
  rows,
}: {
  rows: OrganizerRow[];
}) {
  return (
    <section className="admin-section admin-section--wide moderator-organizers-section">
      <div className="admin-panel__heading admin-section__title">
        <h2>Comptes employes</h2>
        <span className="admin-count">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="Aucun compte employe rattache." />
      ) : (
        <div
          className="admin-table admin-table--organizers"
          role="table"
          aria-label="Comptes employes"
        >
          <div role="rowgroup">
            {rows.map(({ member, user, account, organization }) => {
              const isActiveAccount =
                !!account &&
                account.is_active &&
                !account.deleted_at &&
                !isAccountSuspended(account);
              const statusLabel = !account
                ? "Compte introuvable"
                : isAccountSuspended(account)
                  ? "Suspendu"
                  : isActiveAccount
                    ? "Actif"
                    : "Inactif";

              return (
                <div className="admin-table__row" role="row" key={member.id}>
                  <div className="moderator-account-identity" role="cell">
                    <span>{user?.username ?? `Utilisateur #${member.user_id}`}</span>
                    <small>Membre #{member.id}</small>
                  </div>
                  <span role="cell">
                    {account?.login_email ?? "Email introuvable"}
                  </span>
                  <span role="cell">
                    {organization?.name ?? `Organization #${member.organization_id}`}
                  </span>
                  <span role="cell">{member.job_role ?? "Non renseigne"}</span>
                  <StatusBadge
                    variant={isActiveAccount ? "active" : "pending"}
                    role="cell"
                  >
                    {statusLabel}
                  </StatusBadge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function SuspendedAccountsSection({
  userAccounts,
  organizationAccounts,
  onLift,
}: {
  userAccounts: AccountSummary[];
  organizationAccounts: AccountSummary[];
  onLift: (account: AccountSummary) => void;
}) {
  const totalSuspendedAccounts = userAccounts.length + organizationAccounts.length;

  if (totalSuspendedAccounts === 0) return null;

  return (
    <section className="admin-section admin-section--wide moderator-suspended-section">
      <div className="admin-panel__heading admin-section__title">
        <h2>Suspensions en cours</h2>
        <span className="admin-count">{totalSuspendedAccounts}</span>
      </div>

      <div className="moderator-suspended-groups">
        <SuspendedAccountList
          title="Utilisateurs"
          accounts={userAccounts}
          onLift={onLift}
        />
        <SuspendedAccountList
          title="Organizations"
          accounts={organizationAccounts}
          onLift={onLift}
        />
      </div>
    </section>
  );
}

function SuspendedOrganizationsSection({
  accounts,
  onLift,
}: {
  accounts: AccountSummary[];
  onLift: (account: AccountSummary) => void;
}) {
  return (
    <section className="admin-section admin-section--wide moderator-suspended-section">
      <div className="admin-panel__heading admin-section__title">
        <h2>Organizations suspendues</h2>
        <span className="admin-count">{accounts.length}</span>
      </div>

      {accounts.length === 0 ? (
        <EmptyState message="Aucune organization suspendue." />
      ) : (
        <SuspendedAccountList
          title="Organizations"
          accounts={accounts}
          onLift={onLift}
        />
      )}
    </section>
  );
}

function SuspendedAccountList({
  title,
  accounts,
  onLift,
}: {
  title: string;
  accounts: AccountSummary[];
  onLift: (account: AccountSummary) => void;
}) {
  if (accounts.length === 0) return null;

  return (
    <div className="moderator-suspended-group">
      <div
        className="admin-table admin-table--suspended"
        role="table"
        aria-label={`${title} suspendus`}
      >
        <div role="rowgroup">
          {accounts.map((account) => (
            <div
              className="admin-table__row moderator-account-row--with-role"
              role="row"
              key={account.account_id}
            >
              <div className="moderator-account-identity" role="cell">
                <span>{account.display_name}</span>
                <small>{account.login_email}</small>
              </div>
              <StatusBadge className="moderator-account-role" role="cell">
                {accountRoleLabels[account.role]}
              </StatusBadge>
              <span role="cell">Jusqu'au {formatDate(account.suspended_until)}</span>
              <span role="cell">{account.suspension_reason ?? "Motif non renseigne"}</span>
              <div role="cell">
                <Button type="button" onClick={() => onLift(account)}>
                  Lever suspension
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getReportTargetLabel(
  report: ModerationReport,
  events: Event[],
  organizations: Organization[],
  accountSummaries: AccountSummary[],
) {
  if (report.target_type === "event") {
    return events.find((event) => event.id === report.target_id)?.title ?? "Evenement";
  }

  if (report.target_type === "organization") {
    return (
      organizations.find((organization) => organization.id === report.target_id)?.name ??
      "Organization"
    );
  }

  return (
    accountSummaries.find((account) => account.account_id === report.target_id)
      ?.display_name ?? `Compte #${report.target_id}`
  );
}

function getUserName(userId: number, users: User[]) {
  return users.find((user) => user.id === userId)?.username ?? `Utilisateur #${userId}`;
}
