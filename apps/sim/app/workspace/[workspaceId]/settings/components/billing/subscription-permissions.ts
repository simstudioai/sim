import { isTrialingSubscription } from '@/lib/billing/subscriptions/utils'

export interface SubscriptionPermissions {
  canUpgradeToPro: boolean
  canUpgradeToTeam: boolean
  canViewEnterprise: boolean
  canManageTeam: boolean
  /** Manage payment method and cancel or restore the plan. */
  canManageBilling: boolean
  /** Save a payment method for automatic payment on a self-serve Enterprise contract. */
  canManageEnterprisePayment: boolean
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
  /** An Enterprise contract an admin opted into self-serve usage limits, seats, and payment. */
  isEnterpriseSelfServe: boolean
  /** Active or trialing and not billing-blocked; a past-due or blocked plan cannot change limits. */
  hasUsableAccess: boolean
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
  const { isFree, isPro, isEnterprise, isPaid, isOrgScoped, isEnterpriseSelfServe } = subscription
  const isTrialing = isTrialingSubscription(subscription)
  const { isTeamAdmin } = userRole

  // Non-admin org members see the "team member" view: no edit / no cancel
  // / no upgrade, pooled usage display.
  const orgMemberOnly = isOrgScoped && !isTeamAdmin
  const orgAdminOrSolo = !isOrgScoped || isTeamAdmin

  const isEnterpriseMember = isEnterprise && !isTeamAdmin
  const canManageBilling = (isFree || (isPaid && !isEnterprise)) && orgAdminOrSolo
  const canManageEnterprisePayment = isEnterpriseSelfServe && isTeamAdmin
  const canViewUsageInfo = !isEnterpriseMember

  return {
    canUpgradeToPro: isFree,
    // A trial becomes a team plan only after it converts.
    canUpgradeToTeam: isFree || (isPro && !isOrgScoped && !isTrialing),
    canViewEnterprise: !isEnterprise && !orgMemberOnly,
    canManageTeam: isOrgScoped && isTeamAdmin && !isEnterprise,
    canManageBilling,
    canManageEnterprisePayment,
    canEditUsageLimit:
      (canManageBilling || canManageEnterprisePayment) &&
      !isTrialing &&
      subscription.hasUsableAccess,
    canCancelSubscription: isPaid && !isEnterprise && orgAdminOrSolo,
    showTeamMemberView: orgMemberOnly,
    showUpgradePlans:
      (isFree || (isPro && !isOrgScoped) || (isOrgScoped && isTeamAdmin)) && !isEnterprise,
    isEnterpriseMember,
    canViewUsageInfo,
  }
}
