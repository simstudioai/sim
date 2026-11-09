import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import '@/platform/styles/bootstrap.css'
import '@sim/emcn-platform/styles/platform.css'
import { env, PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import { publicEnvHtmlAttributes } from '@/lib/core/config/public-env'
import { AppAnalytics, AppHead } from '@/app/_shell/app-document'
import { BrowserTelemetry } from '@/app/_shell/providers/browser-telemetry'
import { ConsentBanner } from '@/app/(product)/_components/consent-banner/consent-banner'
import { DesktopUpdateGate } from '@/app/(product)/_components/desktop-update-gate/desktop-update-gate'
import { ProductShell } from '@/app/(product)/_components/product-shell'
import { generateBrandedMetadata } from '@/ee/whitelabeling'

export const metadata: Metadata = generateBrandedMetadata()

/**
 * The product's own root: the design system's bootstrap and stylesheet, never the site's legacy
 * globals, around the one shell every organization and workspace page shares. Next reloads the
 * document when a navigation crosses into another root.
 */
export default function ProductRootLayout({ children }: { children: ReactNode }) {
  return (
    // The Workflows tab's persisted editor stores write their sizes onto this element as they
    // rehydrate, before React does.
    <html
      lang='en'
      suppressHydrationWarning
      data-public-env={publicEnvHtmlAttributes()[PUBLIC_ENV_ATTRIBUTE]}
    >
      <head>
        <AppHead />
      </head>
      <body>
        <DesktopUpdateGate />
        <AppAnalytics consentBanner={<ConsentBanner />}>
          <ProductShell
            telemetry={
              <BrowserTelemetry
                disabled={env.NEXT_TELEMETRY_DISABLED === '1'}
                consentRequired={isHosted}
              />
            }
          >
            {children}
          </ProductShell>
        </AppAnalytics>
      </body>
    </html>
  )
}
