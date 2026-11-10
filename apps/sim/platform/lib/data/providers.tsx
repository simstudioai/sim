'use client'

import type { ReactNode } from 'react'
import { type DehydratedState, HydrationBoundary, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { SessionProvider } from '@/lib/auth/session-provider'
import { FeatureFlagsProvider } from '@/lib/core/config/feature-flags-context'
import { PasteAdmissionGuard } from '@/lib/core/utils/paste-admission-guard'
import { getQueryClient } from '@/hooks/queries/utils/get-query-client'
import { LiveChatEvents } from '@/platform/lib/data/chat-events'
import { OrganizationProvider } from '@/platform/lib/data/organization'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { type ShellNavigation, useShellData } from '@/platform/lib/data/shell'
import { LiveShellContext } from '@/platform/lib/data/shell-context'

function LiveShellProvider({
  navigation,
  children,
}: {
  navigation: ShellNavigation
  children: ReactNode
}) {
  return (
    <LiveShellContext.Provider value={useShellData(navigation)}>
      {children}
    </LiveShellContext.Provider>
  )
}

interface LiveProvidersProps {
  organization: PlatformOrganization
  navigation: ShellNavigation
  dehydratedState: DehydratedState
  children: ReactNode
}

/** Everything a live Platform route reads from. Fixture and fixture-off sessions never mount it. */
export function LiveProviders({
  organization,
  navigation,
  dehydratedState,
  children,
}: LiveProvidersProps) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <HydrationBoundary state={dehydratedState}>
        <NuqsAdapter>
          <OrganizationProvider organization={organization}>
            <SessionProvider>
              <FeatureFlagsProvider flags={organization.featureFlags}>
                <LiveChatEvents />
                <PasteAdmissionGuard />
                <LiveShellProvider navigation={navigation}>{children}</LiveShellProvider>
              </FeatureFlagsProvider>
            </SessionProvider>
          </OrganizationProvider>
        </NuqsAdapter>
      </HydrationBoundary>
    </QueryClientProvider>
  )
}
