import { renderAsync } from '@react-email/components'
import { OTPVerificationEmail } from './otp-verification-email'
import { ResetPasswordEmail } from './reset-password-email'

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
 * Gets the appropriate email subject based on email type
 */
export function getEmailSubject(
  type: 'sign-in' | 'email-verification' | 'forget-password' | 'reset-password'
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
    default:
      return 'Sim Studio'
  }
}
