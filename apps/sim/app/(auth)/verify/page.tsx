import { isEmailVerificationEnabled, isProd } from '@/lib/core/config/environment'
import { hasEmailService } from '@/lib/email/mailer'
import { VerifyContent } from '@/app/(auth)/verify/verify-content'

export const dynamic = 'force-dynamic'

export default function VerifyPage() {
  const emailServiceConfigured = hasEmailService()

  return (
    <VerifyContent
      hasEmailService={emailServiceConfigured}
      isProduction={isProd}
      isEmailVerificationEnabled={isEmailVerificationEnabled}
    />
  )
}
