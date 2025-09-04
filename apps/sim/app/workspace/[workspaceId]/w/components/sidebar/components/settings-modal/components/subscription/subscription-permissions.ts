export interface SubscriptionPermissions {
  canUpgradeToPro: boolean
  canUpgradeToTeam: boolean
  canViewEnterprise: boolean
  canManageTeam: boolean
  canEditUsageLimit: boolean
  canCancelSubscription: boolean
  showTeamMemberView: boolean
  showUpgradePlans: boolean
}

export interface SubscriptionState {
  isFree: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  isPaid: boolean
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
  const { isFree, isPro, isTeam, isEnterprise, isPaid } = subscription
  const { isTeamAdmin } = userRole

  return {
    canUpgradeToPro: isFree,
    canUpgradeToTeam: isFree || (isPro && !isTeam),
    canViewEnterprise: !isEnterprise && !(isTeam && !isTeamAdmin), // Don't show to enterprise users or team members
    canManageTeam: isTeam && isTeamAdmin,
    canEditUsageLimit: (isFree || (isPro && !isTeam)) && !isEnterprise, // Free users see upgrade badge, Pro (non-team) users see pencil
    canCancelSubscription: isPaid && !isEnterprise && !(isTeam && !isTeamAdmin), // Team members can't cancel
    showTeamMemberView: isTeam && !isTeamAdmin,
    showUpgradePlans: isFree || (isPro && !isTeam) || (isTeam && isTeamAdmin), // Free users, Pro users, Team owners see plans
  }
}

export function getVisiblePlans(
  subscription: SubscriptionState,
  userRole: UserRole
): ('pro' | 'team' | 'enterprise')[] {
  const plans: ('pro' | 'team' | 'enterprise')[] = []
  const { isFree, isPro, isTeam } = subscription
  const { isTeamAdmin } = userRole

  // Free users see all plans
  if (isFree) {
    plans.push('pro', 'team', 'enterprise')
  }
  // Pro users see team and enterprise
  else if (isPro && !isTeam) {
    plans.push('team', 'enterprise')
  }
  // Team owners see only enterprise (no team plan since they already have it)
  else if (isTeam && isTeamAdmin) {
    plans.push('enterprise')
  }
  // Team members, Enterprise users see no plans

  return plans
}
