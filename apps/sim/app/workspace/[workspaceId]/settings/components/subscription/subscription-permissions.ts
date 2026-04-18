export interface SubscriptionPermissions {
  canUpgradeToPro: boolean
  canUpgradeToTeam: boolean
  canViewEnterprise: boolean
  canManageTeam: boolean
  canEditUsageLimit: boolean
  canCancelSubscription: boolean
  showTeamMemberView: boolean
  showUpgradePlans: boolean
  isEnterpriseMember: boolean
  canViewUsageInfo: boolean
}

export interface SubscriptionState {
  isFree: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  isPaid: boolean
  /**
   * True when the subscription's `referenceId` is an organization. Source
   * of truth for scope-based decisions — `pro_*` plans that have been
   * transferred to an org are org-scoped even though `isTeam` is false.
   */
  isOrgScoped: boolean
  plan: string
  status: string
}

export interface UserRole {
  isTeamAdmin: boolean
  userRole: string
}

export function getSubscriptionPermissions(
  subscription: SubscriptionState,
  userRole: UserRole
): SubscriptionPermissions {
  const { isFree, isPro, isTeam, isEnterprise, isPaid, isOrgScoped } = subscription
  const { isTeamAdmin } = userRole

  // "Org-scoped non-admin" collapses all the "team member" behaviors
  // (hidden edit, hidden cancel, no upgrade plans, pooled view, etc.).
  // This includes members of `pro_*` orgs that aren't admins/owners.
  const orgMemberOnly = isOrgScoped && !isTeamAdmin
  const orgAdminOrSolo = !isOrgScoped || isTeamAdmin

  const isEnterpriseMember = isEnterprise && !isTeamAdmin
  const canViewUsageInfo = !isEnterpriseMember

  return {
    canUpgradeToPro: isFree,
    canUpgradeToTeam: isFree || (isPro && !isOrgScoped),
    canViewEnterprise: !isEnterprise && !orgMemberOnly,
    canManageTeam: isOrgScoped && isTeamAdmin && !isEnterprise,
    // Edit the limit when: paid plan (not free, not enterprise) AND either
    // personally-scoped or acting as an org admin/owner.
    canEditUsageLimit: (isFree || (isPaid && !isEnterprise)) && orgAdminOrSolo,
    canCancelSubscription: isPaid && !isEnterprise && orgAdminOrSolo,
    showTeamMemberView: orgMemberOnly,
    showUpgradePlans:
      (isFree || (isPro && !isOrgScoped) || (isTeam && isTeamAdmin)) && !isEnterprise,
    isEnterpriseMember,
    canViewUsageInfo,
  }
}

export function getVisiblePlans(
  subscription: SubscriptionState,
  userRole: UserRole
): ('pro' | 'team' | 'enterprise')[] {
  const plans: ('pro' | 'team' | 'enterprise')[] = []
  const { isFree, isPro, isTeam, isOrgScoped } = subscription
  const { isTeamAdmin } = userRole

  // Free users see all plans
  if (isFree) {
    plans.push('pro', 'team', 'enterprise')
  }
  // Personally-scoped Pro: can upgrade to team or enterprise
  else if (isPro && !isOrgScoped) {
    plans.push('team', 'enterprise')
  }
  // Team/org owners/admins: only enterprise (already on a team-level plan)
  else if (isOrgScoped && isTeamAdmin && !isTeam) {
    plans.push('enterprise')
  } else if (isTeam && isTeamAdmin) {
    plans.push('enterprise')
  }
  // Team/org members, Enterprise users see no plans

  return plans
}
