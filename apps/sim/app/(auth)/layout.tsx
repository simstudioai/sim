import type { Metadata, Viewport } from 'next'
import { isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { AttributionCapture } from '@/app/_shell/consent/attribution-capture'
import { SITE_VIEWPORT, SiteRootLayout } from '@/app/_shell/site-root-layout'
import { AuthShell } from '@/app/(auth)/components'
import { generateBrandedMetadata } from '@/ee/whitelabeling'

export const viewport: Viewport = SITE_VIEWPORT

export const metadata: Metadata = generateBrandedMetadata({
  robots: { index: false, follow: false },
})

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteRootLayout>
      <AuthShell registrationDisabled={isRegistrationDisabled}>
        {children}
        <AttributionCapture />
      </AuthShell>
    </SiteRootLayout>
  )
}
