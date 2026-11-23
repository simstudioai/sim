import { UPGRADE_REASON_COPY, type UpgradeReason } from '@/lib/billing/upgrade-reasons'

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
  | 'permission-access-request-created'
  | 'permission-access-request-decided'
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
  switch (type) {
    case 'sign-in':
      return `Sign in to Sim`
    case 'email-verification':
      return `Verify your email for Sim`
    case 'change-email':
      return `Verify your new email for Sim`
    case 'forget-password':
      return `Reset your Sim password`
    case 'reset-password':
      return `Reset your Sim password`
    case 'existing-account':
      return `Sign-up attempt with your Sim email`
    case 'invitation':
      return `You've been invited to join a team on Sim`
    case 'enterprise-owner-invitation':
      return `Activate your Enterprise organization on Sim`
    case 'batch-invitation':
      return `You've been invited to join a team and workspaces on Sim`
    case 'workspace-added':
      return `You've been added to a workspace on Sim`
    case 'permission-access-request-created':
      return `An access request needs review on Sim`
    case 'permission-access-request-decided':
      return `Your access request was updated on Sim`
    case 'enterprise-subscription':
      return `Your Enterprise Plan is now active on Sim`
    case 'usage-threshold':
      return `You're nearing your monthly budget on Sim`
    case 'free-tier-upgrade':
      return `You're at 80% of your free credits on Sim`
    case 'payment-failed':
      return `Payment failed on Sim — action required`
    case 'credit-purchase':
      return `Credits added to your Sim account`
    case 'abandoned-checkout':
      return `Quick question`
    case 'free-tier-exhausted':
      return `You've run out of free credits on Sim`
    case 'schedule-disabled':
      return `A schedule was turned off on Sim`
    case 'subprocessor-change':
      return `Upcoming change to Sim sub-processors`
    case 'onboarding-followup':
      return `Quick question about Sim`
    case 'welcome':
      return `Welcome to Sim`
    default:
      return 'Sim'
  }
}

/**
 * Subject line for a per-category usage-limit email. Reuses the shared
 * {@link UPGRADE_REASON_COPY} so the subject matches the email body and the
 * upgrade-page header the user lands on.
 */
export function getLimitEmailSubject(reason: UpgradeReason, kind: 'warning' | 'reached'): string {
  const copy = UPGRADE_REASON_COPY[reason]
  const subject = kind === 'reached' ? copy.reachedSubject : copy.warningSubject
  return `${subject} on Sim`
}

/** The plan's display name is resolved at send time; it carries tier qualifiers. */
export function getPlanWelcomeSubject(planDisplayName: string): string {
  return `Your ${planDisplayName} plan is now active on Sim`
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

/**
 * Names the workspace so an external recipient can identify the request, and the
 * inviter when there is one — a workflow-issued invitation has no person to name.
 */
export function getCredentialGroupInvitationSubject(
  inviterName: string | undefined,
  workspaceName: string
): string {
  return inviterName
    ? `${inviterName} invited you to connect accounts for ${workspaceName} on Sim`
    : `You have been invited to connect accounts for ${workspaceName} on Sim`
}
