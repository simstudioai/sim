import { renderAsync } from '@react-email/components'
import { OTPVerificationEmail } from './otp-verification-email'
import { ResetPasswordEmail } from './reset-password-email'
import { WaitlistApprovalEmail } from './waitlist-approval-email'
import { WaitlistConfirmationEmail } from './waitlist-confirmation-email'
import { InvitationEmail } from './invitation-email'

/**
 * Renders the OTP verification email to HTML
 */
export async function renderOTPEmail(
  otp: string,
  email: string,
  type: 'sign-in' | 'email-verification' | 'forget-password' = 'email-verification'
): Promise<string> {
  return await renderAsync(OTPVerificationEmail({ otp, email, type }))
}

/**
 * Renders the password reset email to HTML
 */
export async function renderPasswordResetEmail(
  username: string,
  resetLink: string
): Promise<string> {
  return await renderAsync(ResetPasswordEmail({ username, resetLink, updatedDate: new Date() }))
}

/**
 * Renders the invitation email to HTML
 */
export async function renderInvitationEmail(
  inviterName: string,
  organizationName: string,
  inviteLink: string,
  invitedEmail: string
): Promise<string> {
  return await renderAsync(InvitationEmail({ 
    inviterName, 
    organizationName, 
    inviteLink, 
    invitedEmail, 
    updatedDate: new Date() 
  }))
}

/**
 * Renders the waitlist confirmation email to HTML
 */
export async function renderWaitlistConfirmationEmail(email: string): Promise<string> {
  return await renderAsync(WaitlistConfirmationEmail({ email }))
}

/**
 * Renders the waitlist approval email to HTML
 */
export async function renderWaitlistApprovalEmail(
  email: string,
  signupLink: string
): Promise<string> {
  return await renderAsync(WaitlistApprovalEmail({ email, signupLink }))
}

/**
 * Gets the appropriate email subject based on email type
 */
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
