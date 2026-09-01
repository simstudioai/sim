import type { Metadata } from 'next'
import { isProd } from '@/lib/core/config/env-flags'
import { hasEmailService } from '@/lib/messaging/email/mailer'
import { isEmailVerificationEffectivelyEnabled } from '@/lib/messaging/email/verification'
import { VerifyContent } from '@/app/(auth)/verify/verify-content'

export const metadata: Metadata = {
  title: 'Verify Email',
}

export const dynamic = 'force-dynamic'

export default function VerifyPage() {
  const emailServiceConfigured = hasEmailService()

  return (
    <VerifyContent
      hasEmailService={emailServiceConfigured}
      isProduction={isProd}
      isEmailVerificationEnabled={isEmailVerificationEffectivelyEnabled()}
    />
  )
}
