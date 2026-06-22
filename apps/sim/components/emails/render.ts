import { render } from '@react-email/render'
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
  UsageThresholdEmail,
} from '@/components/emails/billing'
import {
  BatchInvitationEmail,
  InvitationEmail,
  PollingGroupInvitationEmail,
  WorkspaceAddedEmail,
  WorkspaceInvitationEmail,
} from '@/components/emails/invitations'
import { HelpConfirmationEmail } from '@/components/emails/support'
import type { UpgradeReason } from '@/lib/billing/upgrade-reasons'
import { getBaseUrl } from '@/lib/core/utils/urls'

export { getEmailSubject, getLimitEmailSubject } from './subjects'

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

export async function renderPollingGroupInvitationEmail(params: {
  inviterName: string
  organizationName: string
  pollingGroupName: string
  provider: 'google-email' | 'outlook'
  inviteLink: string
}): Promise<string> {
  return await render(
    PollingGroupInvitationEmail({
      inviterName: params.inviterName,
      organizationName: params.organizationName,
      pollingGroupName: params.pollingGroupName,
      provider: params.provider,
      inviteLink: params.inviteLink,
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
