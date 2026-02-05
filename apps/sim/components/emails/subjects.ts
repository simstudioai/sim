import { getBrandConfig } from '@/ee/whitelabeling'

/** Email subject type for all supported email templates */
export type EmailSubjectType =
  | 'sign-in'
  | 'email-verification'
  | 'forget-password'
  | 'reset-password'
  | 'invitation'
  | 'batch-invitation'
  | 'polling-group-invitation'
  | 'help-confirmation'
  | 'enterprise-subscription'
  | 'usage-threshold'
  | 'free-tier-upgrade'
  | 'plan-welcome-pro'
  | 'plan-welcome-team'
  | 'credit-purchase'
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
    case 'forget-password':
      return `Reset your ${brandName} password`
    case 'reset-password':
      return `Reset your ${brandName} password`
    case 'invitation':
      return `You've been invited to join a team on ${brandName}`
    case 'batch-invitation':
      return `You've been invited to join a team and workspaces on ${brandName}`
    case 'polling-group-invitation':
      return `You've been invited to join an email polling group on ${brandName}`
    case 'help-confirmation':
      return 'Your request has been received'
    case 'enterprise-subscription':
      return `Your Enterprise Plan is now active on ${brandName}`
    case 'usage-threshold':
      return `You're nearing your monthly budget on ${brandName}`
    case 'free-tier-upgrade':
      return `You're at 90% of your free credits on ${brandName}`
    case 'plan-welcome-pro':
      return `Your Pro plan is now active on ${brandName}`
    case 'plan-welcome-team':
      return `Your Team plan is now active on ${brandName}`
    case 'credit-purchase':
      return `Credits added to your ${brandName} account`
    case 'welcome':
      return `Welcome to ${brandName}`
    default:
      return brandName
  }
}
