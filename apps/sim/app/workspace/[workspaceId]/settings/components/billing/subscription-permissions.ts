import { isTrialingSubscription } from '@/lib/billing/subscriptions/utils'

export interface SubscriptionPermissions {
  canUpgradeToPro: boolean
  canUpgradeToTeam: boolean
  canViewEnterprise: boolean
  canManageTeam: boolean
  /** Manage payment method and cancel or restore the plan. */
  canManageBilling: boolean
  /** Change the usage limit or on-demand usage; a trial's allowance is fixed. */
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
  const { isFree, isPro, isEnterprise, isPaid, isOrgScoped } = subscription
  const isTrialing = isTrialingSubscription(subscription)
  const { isTeamAdmin } = userRole

  // Non-admin org members see the "team member" view: no edit / no cancel
  // / no upgrade, pooled usage display.
  const orgMemberOnly = isOrgScoped && !isTeamAdmin
  const orgAdminOrSolo = !isOrgScoped || isTeamAdmin

  const isEnterpriseMember = isEnterprise && !isTeamAdmin
  const canManageBilling = (isFree || (isPaid && !isEnterprise)) && orgAdminOrSolo
  const canViewUsageInfo = !isEnterpriseMember

  return {
    canUpgradeToPro: isFree,
    // A trial becomes a team plan only after it converts.
    canUpgradeToTeam: isFree || (isPro && !isOrgScoped && !isTrialing),
    canViewEnterprise: !isEnterprise && !orgMemberOnly,
    canManageTeam: isOrgScoped && isTeamAdmin && !isEnterprise,
    canManageBilling,
    canEditUsageLimit: canManageBilling && !isTrialing,
    canCancelSubscription: isPaid && !isEnterprise && orgAdminOrSolo,
    showTeamMemberView: orgMemberOnly,
    showUpgradePlans:
      (isFree || (isPro && !isOrgScoped) || (isOrgScoped && isTeamAdmin)) && !isEnterprise,
    isEnterpriseMember,
    canViewUsageInfo,
  }
}
