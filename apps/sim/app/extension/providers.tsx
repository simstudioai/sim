'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { SettingsNavigationProvider } from '@/components/settings/settings-navigation-provider'
import { useSession } from '@/lib/auth/client'
import ExtensionLoading from '@/app/extension/loading'
import { ExtensionSignIn } from '@/app/extension/sign-in'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

interface ExtensionIdentity {
  origins: string[]
  userId: string
}

const ExtensionIdentityContext = createContext<ExtensionIdentity | null>(null)

interface ExtensionProvidersProps extends ExtensionIdentity {
  children: ReactNode
  modelSelectorEnabled: boolean
  planModeEnabled: boolean
}

export function ExtensionProviders({
  children,
  origins,
  userId,
  modelSelectorEnabled,
  planModeEnabled,
}: ExtensionProvidersProps) {
  const { data: session, isPending, error } = useSession()
  if (isPending) return <ExtensionLoading />
  if (error || !session?.user || session.user.id !== userId) return <ExtensionSignIn />
  return (
    <ExtensionIdentityContext.Provider value={{ origins, userId }}>
      <FeatureFlagsProvider
        flags={{
          dashboards: false,
          'workflow-tests': false,
          changelog: false,
          'mothership-model-selector': modelSelectorEnabled,
          'mothership-plan-mode': planModeEnabled,
          'mothership-computer-use': false,
        }}
      >
        <SettingsNavigationProvider navigationTarget='_blank'>
          <div className='ph-no-capture'>{children}</div>
        </SettingsNavigationProvider>
      </FeatureFlagsProvider>
    </ExtensionIdentityContext.Provider>
  )
}

/** The extension's configured parent origins and authenticated chat identity. */
export function useExtensionIdentity(): ExtensionIdentity {
  const identity = useContext(ExtensionIdentityContext)
  if (!identity) throw new Error('Extension identity is unavailable')
  return identity
}
