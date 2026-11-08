import type { ReactNode } from 'react'
import { AssetsProvider } from '@sim/emcn/icon/assets'
import type { Metadata } from 'next'
import '@/platform/styles/bootstrap.css'
import '@sim/emcn-platform/styles/platform.css'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = {
  title: 'Sim Platform',
  description: 'Home, conversations, and account preferences in Sim.',
  robots: { index: false, follow: false },
}

interface RootLayoutProps {
  children: ReactNode
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const publicEnv =
    resolvePlatformMode() === 'live'
      ? (await import('@/platform/lib/data/public-env')).readPublicEnvAttribute()
      : undefined
  return (
    // The Workflows tab's persisted editor stores write their sizes onto this element as they rehydrate,
    // before React does, as the legacy root allows.
    <html lang='en' data-public-env={publicEnv} suppressHydrationWarning>
      <body>
        <AssetsProvider basePath={process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH ?? ''}>
          {children}
        </AssetsProvider>
      </body>
    </html>
  )
}
