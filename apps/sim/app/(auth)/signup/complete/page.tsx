import type { Metadata } from 'next'
import { Suspense } from 'react'
import { isHosted } from '@/lib/core/config/env-flags'
import { SocialSignUpCompletion } from '@/app/(auth)/signup/complete/social-sign-up-completion'

export const metadata: Metadata = {
  title: 'Finishing Sign Up',
}

export default function SocialSignUpCompletePage() {
  return (
    <Suspense fallback={null}>
      <SocialSignUpCompletion consentRequired={isHosted} />
    </Suspense>
  )
}
