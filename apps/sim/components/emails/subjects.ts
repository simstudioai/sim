import { UPGRADE_REASON_COPY, type UpgradeReason } from '@/lib/billing/upgrade-reasons'
import { getBrandConfig } from '@/ee/whitelabeling'

/** Email subject type for all supported email templates */
export type EmailSubjectType =
  | 'sign-in'
  | 'email-verification'
  | 'change-email'
  | 'forget-password'
  | 'reset-password'
  | 'existing-account'
  | 'invitation'
  | 'enterprise-owner-invitation'
  | 'batch-invitation'
  | 'workspace-added'
  | 'enterprise-subscription'
  | 'usage-threshold'
  | 'free-tier-upgrade'
  | 'payment-failed'
  | 'credit-purchase'
  | 'abandoned-checkout'
  | 'free-tier-exhausted'
  | 'schedule-disabled'
  | 'subprocessor-change'
  | 'onboarding-followup'
  | 'welcome'

/**
 * Returns the email subject line for a given email type.
 * @param type - The type of email being sent
 * @returns The subject line for the email
 */
export function getEmailSubject(type: EmailSubjectType): string {
  const brandName = getBrandConfig().name

  switch (type) {
    case 'sign-in':
      return `Sign in to ${brandName}`
    case 'email-verification':
      return `Verify your email for ${brandName}`
    case 'change-email':
      return `Verify your new email for ${brandName}`
    case 'forget-password':
      return `Reset your ${brandName} password`
    case 'reset-password':
      return `Reset your ${brandName} password`
    case 'existing-account':
      return `Sign-up attempt with your ${brandName} email`
    case 'invitation':
      return `You've been invited to join a team on ${brandName}`
    case 'enterprise-owner-invitation':
      return `Activate your Enterprise organization on ${brandName}`
    case 'batch-invitation':
      return `You've been invited to join a team and workspaces on ${brandName}`
    case 'workspace-added':
      return `You've been added to a workspace on ${brandName}`
    case 'enterprise-subscription':
      return `Your Enterprise Plan is now active on ${brandName}`
    case 'usage-threshold':
      return `You're nearing your monthly budget on ${brandName}`
    case 'free-tier-upgrade':
      return `You're at 80% of your free credits on ${brandName}`
    case 'payment-failed':
      return `Payment failed on ${brandName} — action required`
    case 'credit-purchase':
      return `Credits added to your ${brandName} account`
    case 'abandoned-checkout':
      return `Quick question`
    case 'free-tier-exhausted':
      return `You've run out of free credits on ${brandName}`
    case 'schedule-disabled':
      return `A schedule was turned off on ${brandName}`
    case 'subprocessor-change':
      return `Upcoming change to ${brandName} sub-processors`
    case 'onboarding-followup':
      return `Quick question about ${brandName}`
    case 'welcome':
      return `Welcome to ${brandName}`
    default:
      return brandName
  }
}

/**
 * Subject line for a per-category usage-limit email. Reuses the shared
 * {@link UPGRADE_REASON_COPY} so the subject matches the email body and the
 * upgrade-page header the user lands on.
 */
export function getLimitEmailSubject(reason: UpgradeReason, kind: 'warning' | 'reached'): string {
  const brandName = getBrandConfig().name
  const copy = UPGRADE_REASON_COPY[reason]
  const subject = kind === 'reached' ? copy.reachedSubject : copy.warningSubject
  return `${subject} on ${brandName}`
}

/** The plan's display name is resolved at send time; it carries tier qualifiers. */
export function getPlanWelcomeSubject(planDisplayName: string): string {
  return `Your ${planDisplayName} plan is now active on ${getBrandConfig().name}`
}

/** Echoes the sender's own subject line so the reply threads correctly. */
export function getRequestConfirmationSubject(userSubject: string, requestType?: string): string {
  return requestType
    ? `Your ${requestType} request has been received: ${userSubject}`
    : `We've received your message: ${userSubject}`
}

/** Names the resource being unlocked rather than the brand — that is what the recipient opened. */
export function getOtpSubject(resourceLabel: string): string {
  return `Verification code for ${resourceLabel}`
}

/** Names both the inviter and workspace so an external recipient can identify the request. */
export function getCredentialGroupInvitationSubject(
  inviterName: string,
  workspaceName: string
): string {
  return `${inviterName} invited you to connect accounts for ${workspaceName} on ${getBrandConfig().name}`
}
