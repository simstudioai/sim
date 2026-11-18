'use client'

import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react'
import type { AppToExtensionMessage } from '@sim/browser-extension-protocol'
import { SettingsNavigationProvider } from '@/components/settings/settings-navigation-provider'
import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import ExtensionLoading from '@/app/extension/loading'
import { ExtensionSignIn } from '@/app/extension/sign-in'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { ChatInputFocusContext, type ChatInputFocusHandle } from '@/hooks/use-chat-input-focus'

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
  const focusComposer = useRef<ChatInputFocusHandle | null>(null)
  const { data: session, isPending, error } = useSession()
  const signedIn = session?.user?.id === userId
  useEffect(() => {
    if (!signedIn) return
    const message: AppToExtensionMessage = {
      channel: 'sim-extension',
      version: 1,
      type: 'signed-in',
    }
    for (const origin of origins) window.parent.postMessage(message, origin)
  }, [origins, signedIn])
  if (isPending) return <ExtensionLoading />
  const accessDenied = isApiClientError(error) && (error.status === 401 || error.status === 403)
  if (accessDenied || !session?.user || session.user.id !== userId)
    return <ExtensionSignIn expectedUserId={userId} />
  return (
    <ExtensionIdentityContext.Provider value={{ origins, userId }}>
      <FeatureFlagsProvider
        flags={{
          dashboards: false,
          'workflow-tests': false,
          changelog: false,
          'mothership-model-selector': modelSelectorEnabled,
          'mothership-plan-mode': planModeEnabled,
        }}
      >
        <SettingsNavigationProvider navigationTarget='_blank'>
          <ChatInputFocusContext.Provider value={focusComposer}>
            <div className='ph-no-capture'>{children}</div>
          </ChatInputFocusContext.Provider>
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

export function ExtensionSessionExpired() {
  const { userId } = useExtensionIdentity()
  return <ExtensionSignIn expectedUserId={userId} />
}
