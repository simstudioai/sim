import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import '@/platform/styles/bootstrap.css'
import '@sim/emcn-platform/styles/platform.css'
import { publicEnvHtmlAttributes } from '@/lib/core/config/public-env'
import { AppAnalytics, AppHead } from '@/app/_shell/app-document'
import { DesktopUpdateGate } from '@/app/_shell/desktop-update-gate'
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
    <html lang='en' suppressHydrationWarning {...publicEnvHtmlAttributes()}>
      <head>
        <AppHead />
      </head>
      <body>
        <DesktopUpdateGate />
        <AppAnalytics>
          <ProductShell>{children}</ProductShell>
        </AppAnalytics>
      </body>
    </html>
  )
}
