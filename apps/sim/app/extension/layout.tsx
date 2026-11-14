import type { ReactNode } from 'react'
import { getSession } from '@/lib/auth'
import { getBrowserExtensionOrigins } from '@/lib/core/security/extension'
import { isMothershipModelSelectorEnabled, isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { ExtensionPrivacy } from '@/app/extension/privacy'
import { ExtensionProviders } from '@/app/extension/providers'
import { ExtensionSignIn } from '@/app/extension/sign-in'
import { ExtensionTheme } from '@/app/extension/theme'

interface ExtensionLayoutProps {
  children: ReactNode
}

export const metadata = { title: 'Sim', robots: { index: false, follow: false } }

/**
 * The compact chat surface. The browser extension frames it in its side panel, and the desktop
 * app's quick chat window opens it top-level, so it renders on deployments without the extension
 * too: with no extension origins the proxy's `frame-ancestors 'none'` keeps it unframeable.
 */
export default async function ExtensionLayout({ children }: ExtensionLayoutProps) {
  const origins = getBrowserExtensionOrigins()
  const session = await getSession()
  if (!session?.user)
    return (
      <>
        <ExtensionPrivacy />
        <ExtensionTheme origins={origins} />
        <ExtensionSignIn />
      </>
    )
  const [modelSelectorEnabled, planModeEnabled] = await Promise.all([
    isMothershipModelSelectorEnabled(),
    isPlanModeEnabled(session.user.id).catch(() => false),
  ])
  return (
    <>
      <ExtensionPrivacy />
      <ExtensionTheme origins={origins} />
      <ExtensionProviders
        origins={origins}
        userId={session.user.id}
        modelSelectorEnabled={modelSelectorEnabled}
        planModeEnabled={planModeEnabled}
      >
        {children}
      </ExtensionProviders>
    </>
  )
}
