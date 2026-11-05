'use client'

import type { ReactNode } from 'react'
import { type DehydratedState, HydrationBoundary, QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { OrganizationProvider } from '@/platform/lib/data/organization'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { getQueryClient } from '@/platform/lib/data/query-client'
import { SessionProvider } from '@/platform/lib/data/session'
import { type ShellNavigation, useShellData } from '@/platform/lib/data/shell'
import { LiveShellContext } from '@/platform/lib/data/shell-context'

function LiveShellProvider({
  navigation,
  children,
}: {
  navigation: ShellNavigation
  children: ReactNode
}) {
  const shell = useShellData(navigation)
  return <LiveShellContext.Provider value={shell}>{children}</LiveShellContext.Provider>
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
              <LiveShellProvider navigation={navigation}>{children}</LiveShellProvider>
            </SessionProvider>
          </OrganizationProvider>
        </NuqsAdapter>
      </HydrationBoundary>
    </QueryClientProvider>
  )
}
