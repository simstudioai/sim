import { render } from '@react-email/components'
import { generateUnsubscribeToken } from '@/lib/email/unsubscribe'
import { InvitationEmail } from './invitation-email'
import { OTPVerificationEmail } from './otp-verification-email'
import { ResetPasswordEmail } from './reset-password-email'
import { WaitlistApprovalEmail } from './waitlist-approval-email'
import { WaitlistConfirmationEmail } from './waitlist-confirmation-email'

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

export async function renderWaitlistConfirmationEmail(email: string): Promise<string> {
  const unsubscribeToken = generateUnsubscribeToken(email, 'marketing')
  return await render(WaitlistConfirmationEmail({ email, unsubscribeToken }))
}

export async function renderWaitlistApprovalEmail(
  email: string,
  signupUrl: string
): Promise<string> {
  const unsubscribeToken = generateUnsubscribeToken(email, 'updates')
  return await render(WaitlistApprovalEmail({ email, signupUrl, unsubscribeToken }))
}

export function getEmailSubject(
  type:
    | 'sign-in'
    | 'email-verification'
    | 'forget-password'
    | 'reset-password'
    | 'waitlist-confirmation'
    | 'waitlist-approval'
    | 'invitation'
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
    case 'waitlist-confirmation':
      return 'Welcome to the Sim Studio Waitlist'
    case 'waitlist-approval':
      return "You've Been Approved to Join Sim Studio!"
    case 'invitation':
      return "You've been invited to join a team on Sim Studio"
    default:
      return 'Sim Studio'
  }
}
