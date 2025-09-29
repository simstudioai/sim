import { hasEmailService } from '@/lib/email/mailer'
import { isEmailVerificationEnabled, isProd } from '@/lib/environment'
import VerifyContent from '@/app/(auth)/verify/verify-client'

/**
 * Server component wrapper for email verification page
 * Handles server-side checks and passes results to client component
 */
export default function VerifyServerWrapper() {
  const emailServiceConfigured = hasEmailService()

  return (
    <VerifyContent
      hasEmailService={emailServiceConfigured}
      isProduction={isProd}
      isEmailVerificationEnabled={isEmailVerificationEnabled}
    />
  )
}
