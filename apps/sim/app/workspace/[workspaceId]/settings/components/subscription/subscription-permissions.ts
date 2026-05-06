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

  // Non-admin org members see the "team member" view: no edit / no cancel
  // / no upgrade, pooled usage display.
  const orgMemberOnly = isOrgScoped && !isTeamAdmin
  const orgAdminOrSolo = !isOrgScoped || isTeamAdmin

  const isEnterpriseMember = isEnterprise && !isTeamAdmin
  const canViewUsageInfo = !isEnterpriseMember

  return {
    canUpgradeToPro: isFree,
    canUpgradeToTeam: isFree || (isPro && !isOrgScoped),
    canViewEnterprise: !isEnterprise && !orgMemberOnly,
    canManageTeam: isOrgScoped && isTeamAdmin && !isEnterprise,
    canEditUsageLimit: (isFree || (isPaid && !isEnterprise)) && orgAdminOrSolo,
    canCancelSubscription: isPaid && !isEnterprise && orgAdminOrSolo,
    showTeamMemberView: orgMemberOnly,
    showUpgradePlans:
      (isFree || (isPro && !isOrgScoped) || (isOrgScoped && isTeamAdmin)) && !isEnterprise,
    isEnterpriseMember,
    canViewUsageInfo,
  }
}

export function getVisiblePlans(
  subscription: SubscriptionState,
  userRole: UserRole
): ('pro' | 'team' | 'enterprise')[] {
  const plans: ('pro' | 'team' | 'enterprise')[] = []
  const { isFree, isPro, isEnterprise, isOrgScoped } = subscription
  const { isTeamAdmin } = userRole

  if (isFree) {
    plans.push('pro', 'team', 'enterprise')
  } else if (isPro && !isOrgScoped) {
    plans.push('team', 'enterprise')
  } else if (isOrgScoped && isTeamAdmin && !isEnterprise) {
    plans.push('enterprise')
  }

  return plans
}
