import { render } from 'react-email'
import { InboxErrorEmail, InboxResponseEmail } from '@/components/emails/agent/inbox-response-email'
import {
  ExistingAccountEmail,
  OnboardingFollowupEmail,
  OTPVerificationEmail,
  ResetPasswordEmail,
  WelcomeEmail,
} from '@/components/emails/auth'
import {
  AbandonedCheckoutEmail,
  CreditPurchaseEmail,
  CreditsExhaustedEmail,
  EnterpriseSubscriptionEmail,
  FreeTierUpgradeEmail,
  LimitThresholdEmail,
  PaymentFailedEmail,
  PlanWelcomeEmail,
  UsageLimitReachedEmail,
  UsageThresholdEmail,
} from '@/components/emails/billing'
import {
  BatchInvitationEmail,
  EnterpriseOwnerInvitationEmail,
  InvitationEmail,
  WorkspaceAddedEmail,
  WorkspaceInvitationEmail,
} from '@/components/emails/invitations'
import {
  ScheduleDisabledEmail,
  type SubprocessorChange,
  SubprocessorChangeEmail,
} from '@/components/emails/notifications'
import { HelpConfirmationEmail } from '@/components/emails/support'
import type { UpgradeReason } from '@/lib/billing/upgrade-reasons'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { ScheduleDisableReason } from '@/lib/workflows/schedules/disable-reasons'

interface WorkspaceInvitation {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

export async function renderOTPEmail(
  otp: string,
  email: string,
  type:
    | 'sign-in'
    | 'email-verification'
    | 'change-email'
    | 'forget-password' = 'email-verification',
  chatTitle?: string
): Promise<string> {
  return await render(OTPVerificationEmail({ otp, email, type, chatTitle }))
}

export async function renderExistingAccountEmail(username: string): Promise<string> {
  return await render(ExistingAccountEmail({ username }))
}

export async function renderPasswordResetEmail(
  username: string,
  resetLink: string
): Promise<string> {
  return await render(ResetPasswordEmail({ username, resetLink }))
}

export async function renderInvitationEmail(
  inviterName: string,
  organizationName: string,
  invitationUrl: string
): Promise<string> {
  return await render(
    InvitationEmail({
      inviterName,
      organizationName,
      inviteLink: invitationUrl,
    })
  )
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

export async function renderEnterpriseOwnerInvitationEmail(
  organizationName: string,
  inviteLink: string,
  expiresInDays: number
): Promise<string> {
  return await render(
    EnterpriseOwnerInvitationEmail({ organizationName, inviteLink, expiresInDays })
  )
}

export async function renderHelpConfirmationEmail(
  type: 'bug' | 'feedback' | 'feature_request' | 'other',
  attachmentCount = 0
): Promise<string> {
  return await render(
    HelpConfirmationEmail({
      type,
      attachmentCount,
      submittedDate: new Date(),
    })
  )
}

export async function renderEnterpriseSubscriptionEmail(userName: string): Promise<string> {
  const baseUrl = getBaseUrl()
  const loginLink = `${baseUrl}/login`

  return await render(
    EnterpriseSubscriptionEmail({
      userName,
      loginLink,
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
    })
  )
}

export async function renderUsageLimitReachedEmail(params: {
  userName?: string
  planName: string
  scope: 'user' | 'organization'
  currentUsage: number
  limit: number
  ctaLink: string
}): Promise<string> {
  return await render(UsageLimitReachedEmail(params))
}

export async function renderScheduleDisabledEmail(params: {
  recipientName?: string
  resourceName?: string
  reason: ScheduleDisableReason
  failedCount?: number
  manageLink?: string
}): Promise<string> {
  return await render(ScheduleDisabledEmail(params))
}

export async function renderSubprocessorChangeEmail(params: {
  recipientName?: string
  changes: SubprocessorChange[]
  effectiveDate: Date
  objectionDeadline: Date
  objectionEmail: string
  subprocessorListUrl: string
  subscriptionUrl?: string
}): Promise<string> {
  return await render(SubprocessorChangeEmail(params))
}

export async function renderFreeTierUpgradeEmail(params: {
  userName?: string
  percentUsed: number
  currentUsage: number
  limit: number
  upgradeLink: string
}): Promise<string> {
  return await render(
    FreeTierUpgradeEmail({
      userName: params.userName,
      percentUsed: params.percentUsed,
      currentUsage: params.currentUsage,
      limit: params.limit,
      upgradeLink: params.upgradeLink,
    })
  )
}

export async function renderLimitThresholdEmail(params: {
  kind: 'warning' | 'reached'
  reason: UpgradeReason
  userName?: string
  usageLabel: string
  limitLabel: string
  percentUsed: number
  upgradeLink: string
}): Promise<string> {
  return await render(LimitThresholdEmail(params))
}

export async function renderPlanWelcomeEmail(params: {
  planName: string
  userName?: string
  loginLink?: string
}): Promise<string> {
  return await render(
    PlanWelcomeEmail({
      planName: params.planName,
      userName: params.userName,
      loginLink: params.loginLink,
    })
  )
}

export async function renderWelcomeEmail(userName?: string): Promise<string> {
  return await render(WelcomeEmail({ userName }))
}

export async function renderOnboardingFollowupEmail(userName?: string): Promise<string> {
  return await render(OnboardingFollowupEmail({ userName }))
}

export async function renderAbandonedCheckoutEmail(userName?: string): Promise<string> {
  return await render(AbandonedCheckoutEmail({ userName }))
}

export async function renderCreditsExhaustedEmail(params: {
  userName?: string
  limit: number
  upgradeLink: string
}): Promise<string> {
  return await render(CreditsExhaustedEmail(params))
}

export async function renderCreditPurchaseEmail(params: {
  userName?: string
  amount: number
  newBalance: number
}): Promise<string> {
  return await render(
    CreditPurchaseEmail({
      userName: params.userName,
      amount: params.amount,
      newBalance: params.newBalance,
      purchaseDate: new Date(),
    })
  )
}

export async function renderWorkspaceInvitationEmail(
  inviterName: string,
  workspaceNames: string[],
  invitationLink: string
): Promise<string> {
  return await render(
    WorkspaceInvitationEmail({
      inviterName,
      workspaceNames,
      invitationLink,
    })
  )
}

export async function renderWorkspaceAddedEmail(
  inviterName: string,
  workspaceName: string,
  workspaceLink: string
): Promise<string> {
  return await render(
    WorkspaceAddedEmail({
      inviterName,
      workspaceName,
      workspaceLink,
    })
  )
}

export async function renderPaymentFailedEmail(params: {
  userName?: string
  amountDue: number
  lastFourDigits?: string
  billingPortalUrl: string
  failureReason?: string
}): Promise<string> {
  return await render(
    PaymentFailedEmail({
      userName: params.userName,
      amountDue: params.amountDue,
      lastFourDigits: params.lastFourDigits,
      billingPortalUrl: params.billingPortalUrl,
      failureReason: params.failureReason,
    })
  )
}

/** Neutralize `javascript:`/`data:` hrefs that agent-authored markdown could emit. */
function stripUnsafeUrls(html: string): string {
  return html.replace(/href\s*=\s*(['"])(?:javascript|vbscript|data):.*?\1/gi, 'href="#"')
}

/** The agent's reply to an inbound email. */
export async function renderInboxResponseEmail(params: {
  markdown: string
  chatUrl: string
}): Promise<string> {
  return stripUnsafeUrls(await render(InboxResponseEmail(params)))
}

/** The agent's reply when the task could not be completed. */
export async function renderInboxErrorEmail(params: {
  error: string
  chatUrl: string
}): Promise<string> {
  return stripUnsafeUrls(await render(InboxErrorEmail(params)))
}
