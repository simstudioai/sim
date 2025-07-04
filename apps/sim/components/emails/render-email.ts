import { render } from '@react-email/components'
import { BatchInvitationEmail } from './batch-invitation-email'
import { BillingConfirmationEmail } from './billing-confirmation-email'
import { InvitationEmail } from './invitation-email'
import { InvoiceNotificationEmail } from './invoice-notification-email'
import { OTPVerificationEmail } from './otp-verification-email'
import { PaymentFailureEmail } from './payment-failure-email'
import { ResetPasswordEmail } from './reset-password-email'

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

export async function renderBillingConfirmationEmail(
  customerEmail: string,
  chargedAmount: number,
  planName: string,
  billingPeriod: string,
  invoiceId: string,
  invoiceUrl?: string
): Promise<string> {
  return await render(
    BillingConfirmationEmail({
      customerEmail,
      chargedAmount,
      planName,
      billingPeriod,
      invoiceId,
      invoiceUrl,
    })
  )
}

export async function renderPaymentFailureEmail(
  customerEmail: string,
  failedAmount: number,
  planName: string,
  billingPeriod: string,
  invoiceId: string,
  invoiceUrl?: string,
  attemptCount?: number
): Promise<string> {
  return await render(
    PaymentFailureEmail({
      customerEmail,
      failedAmount,
      planName,
      billingPeriod,
      invoiceId,
      invoiceUrl,
      attemptCount,
    })
  )
}

export async function renderInvoiceNotificationEmail(
  customerEmail: string,
  invoiceAmount: number,
  planName: string,
  billingPeriod: string,
  invoiceId: string,
  invoiceUrl?: string,
  dueDate?: string
): Promise<string> {
  return await render(
    InvoiceNotificationEmail({
      customerEmail,
      invoiceAmount,
      planName,
      billingPeriod,
      invoiceId,
      invoiceUrl,
      dueDate,
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
    | 'billing-confirmation'
    | 'payment-failure'
    | 'invoice-notification'
): string {
  switch (type) {
    case 'sign-in':
      return 'Sign in to Sim Studio'
    case 'email-verification':
      return 'Verify your email for Sim Studio'
    case 'forget-password':
      return 'Reset your Sim Studio password'
    case 'reset-password':
      return 'Reset your Sim Studio password'
    case 'invitation':
      return "You've been invited to join a team on Sim Studio"
    case 'batch-invitation':
      return "You've been invited to join a team and workspaces on Sim Studio"
    case 'billing-confirmation':
      return 'Payment Confirmed - Sim Studio'
    case 'payment-failure':
      return 'Payment Failed - Action Required'
    case 'invoice-notification':
      return 'Usage Invoice - Sim Studio'
    default:
      return 'Sim Studio'
  }
}
