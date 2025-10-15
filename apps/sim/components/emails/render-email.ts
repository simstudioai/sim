import { render } from '@react-email/components'
import {
  BatchInvitationEmail,
  EnterpriseSubscriptionEmail,
  HelpConfirmationEmail,
  InvitationEmail,
  OTPVerificationEmail,
  PlanWelcomeEmail,
  ResetPasswordEmail,
  UsageThresholdEmail,
} from '@/components/emails'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

export async function renderOTPEmail(
  otp: string,
  email: string,
  type: 'sign-in' | 'email-verification' | 'forget-password' = 'email-verification',
  chatTitle?: string
): Promise<string> {
  return await render(OTPVerificationEmail({ otp, email, type, chatTitle }))
}

export async function renderPasswordResetEmail(
  username: string,
  resetLink: string
): Promise<string> {
  return await render(
    ResetPasswordEmail({ username, resetLink: resetLink, updatedDate: new Date() })
  )
}

export async function renderInvitationEmail(
  inviterName: string,
  organizationName: string,
  invitationUrl: string,
  email: string
): Promise<string> {
  return await render(
    InvitationEmail({
      inviterName,
      organizationName,
      inviteLink: invitationUrl,
      invitedEmail: email,
      updatedDate: new Date(),
    })
  )
}

interface WorkspaceInvitation {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

export async function renderBatchInvitationEmail(
  inviterName: string,
  organizationName: string,
  organizationRole: 'admin' | 'member',
  workspaceInvitations: WorkspaceInvitation[],
  acceptUrl: string
): Promise<string> {
  return await render(
    BatchInvitationEmail({
      inviterName,
      organizationName,
      organizationRole,
      workspaceInvitations,
      acceptUrl,
    })
  )
}

export async function renderHelpConfirmationEmail(
  userEmail: string,
  type: 'bug' | 'feedback' | 'feature_request' | 'other',
  attachmentCount = 0
): Promise<string> {
  return await render(
    HelpConfirmationEmail({
      userEmail,
      type,
      attachmentCount,
      submittedDate: new Date(),
    })
  )
}

export async function renderEnterpriseSubscriptionEmail(
  userName: string,
  userEmail: string
): Promise<string> {
  const baseUrl = getBaseUrl()
  const loginLink = `${baseUrl}/login`

  return await render(
    EnterpriseSubscriptionEmail({
      userName,
      userEmail,
      loginLink,
      createdDate: new Date(),
    })
  )
}

export async function renderUsageThresholdEmail(params: {
  userName?: string
  planName: string
  percentUsed: number
  currentUsage: number
  limit: number
  ctaLink: string
}): Promise<string> {
  return await render(
    UsageThresholdEmail({
      userName: params.userName,
      planName: params.planName,
      percentUsed: params.percentUsed,
      currentUsage: params.currentUsage,
      limit: params.limit,
      ctaLink: params.ctaLink,
      updatedDate: new Date(),
    })
  )
}

export function getEmailSubject(
  type:
    | 'sign-in'
    | 'email-verification'
    | 'forget-password'
    | 'reset-password'
    | 'invitation'
    | 'batch-invitation'
    | 'help-confirmation'
    | 'enterprise-subscription'
    | 'usage-threshold'
    | 'plan-welcome-pro'
    | 'plan-welcome-team'
): string {
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
    case 'help-confirmation':
      return 'Your request has been received'
    case 'enterprise-subscription':
      return `Your Enterprise Plan is now active on ${brandName}`
    case 'usage-threshold':
      return `You're nearing your monthly budget on ${brandName}`
    case 'plan-welcome-pro':
      return `Your Pro plan is now active on ${brandName}`
    case 'plan-welcome-team':
      return `Your Team plan is now active on ${brandName}`
    default:
      return brandName
  }
}

export async function renderPlanWelcomeEmail(params: {
  planName: 'Pro' | 'Team'
  userName?: string
  loginLink?: string
}): Promise<string> {
  return await render(
    PlanWelcomeEmail({
      planName: params.planName,
      userName: params.userName,
      loginLink: params.loginLink,
      createdDate: new Date(),
    })
  )
}
