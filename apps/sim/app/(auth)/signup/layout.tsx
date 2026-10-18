import type { ReactNode } from 'react'
import { isHosted } from '@/lib/core/config/env-flags'
import { SignupConsentTracking } from '@/app/(auth)/signup/signup-consent-tracking'

interface SignupLayoutProps {
  children: ReactNode
}

export default function SignupLayout({ children }: SignupLayoutProps) {
  return (
    <>
      {children}
      {isHosted && <SignupConsentTracking />}
    </>
  )
}
