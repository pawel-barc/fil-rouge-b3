package staff

import "testing"

func TestReportAllowedRoles_IncludesStaff(t *testing.T) {
	allowed := make(map[string]bool, len(reportAllowedRoles))
	for _, role := range reportAllowedRoles {
		allowed[role] = true
	}

	for _, role := range []string{"user", "admin", "moderator"} {
		t.Run(role, func(t *testing.T) {
			if !allowed[role] {
				t.Fatalf("expected %s to be allowed to create reports", role)
			}
		})
	}

	if allowed["organization"] {
		t.Fatalf("expected organization not to be allowed to create reports")
	}
}

func TestCanApplyAction_ModeratorReviewActions(t *testing.T) {
	for _, action := range []string{
		"event_approved",
		"event_rejected",
		"event_hidden",
		"event_deleted",
		"organization_approved",
		"organization_rejected",
	} {
		t.Run(action, func(t *testing.T) {
			if !canApplyAction("moderator", action) {
				t.Fatalf("expected moderator to apply %s", action)
			}
		})
	}
}

func TestOrganizationDecisionLabelsKeepApproveAndRejectDistinct(t *testing.T) {
	if got := notificationTitle("organization_approved"); got != "Organisation validée" {
		t.Fatalf("expected approval title, got %q", got)
	}
	if got := notificationTitle("organization_rejected"); got != "Organisation refusée" {
		t.Fatalf("expected rejection title, got %q", got)
	}
}

func TestNotificationMessageUsesFriendlyText(t *testing.T) {
	if got := notificationMessage("event_approved", "Événement validé"); got != "Votre événement a été validé et publié sur Mappening." {
		t.Fatalf("expected friendly approval message, got %q", got)
	}

	if got := notificationMessage("event_rejected", "Image non conforme"); got != "Votre événement a été refusé par l'équipe de modération. Motif : Image non conforme" {
		t.Fatalf("expected rejection reason to be included, got %q", got)
	}
}

func TestStaffEventListFiltersReturnAllStaffEvents(t *testing.T) {
	filters := staffEventListFilters(ListOptions{})

	if !filters.IncludeInactive {
		t.Fatalf("expected staff event list to include inactive events")
	}
	if filters.IncludeDeleted {
		t.Fatalf("expected staff event list to exclude deleted events")
	}
	if filters.Sort != "newest" {
		t.Fatalf("expected staff event list to sort by newest, got %q", filters.Sort)
	}
	if filters.Limit != 0 || filters.Offset != 0 {
		t.Fatalf("expected staff event list to be unpaginated, got limit=%d offset=%d", filters.Limit, filters.Offset)
	}
}
