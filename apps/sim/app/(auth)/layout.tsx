import type { Metadata } from 'next'
import { isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { AttributionCapture } from '@/app/_shell/consent/attribution-capture'
import { AuthShell } from '@/app/(auth)/components'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthShell registrationDisabled={isRegistrationDisabled}>
      {children}
      <AttributionCapture />
    </AuthShell>
  )
}
