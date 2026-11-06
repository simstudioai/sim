'use client'

import { createContext, type ReactNode, useContext } from 'react'
import {
  type QueryClient,
  QueryClientProvider,
  skipToken,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { SessionContext, type SessionHookResult } from '@/lib/auth/session-context'
import type { LicenseDraft, MothershipEnv } from '@/platform/lib/data/mothership-admin'
import { OrganizationProvider } from '@/platform/lib/data/organization'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

interface FixtureSettingsActions {
  referenceTime: number
  uploadBrandImage: (file: File) => Promise<string>
  previewByokWorkspaces: readonly { id: string; name: string; keySource: string }[]
  generateSampleLicense: (env: MothershipEnv, draft: LicenseDraft) => string
  setSubscriptionCancellation: (cancelled: boolean) => void
}

const FixtureSettings = createContext<FixtureSettingsActions | null>(null)

export function useFixtureSettingsActions() {
  return useContext(FixtureSettings)
}

export function useFixtureSettings() {
  return Boolean(useFixtureSettingsActions())
}

/** Saved examples belong to the active fixture client for its entire browser session. */
export function useSettingsFixtureDraft<T>(
  section: 'admin' | 'connected-accounts' | 'integrations' | 'search-slack',
  initial: T
) {
  const fixture = useFixtureSettings()
  const client = useQueryClient()
  const queryKey = ['settings-fixture-draft', section]
  const { data } = useQuery<T>({
    queryKey,
    queryFn: skipToken,
    initialData: fixture ? () => initial : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: fixture ? Number.POSITIVE_INFINITY : 0,
  })
  return {
    data: data ?? initial,
    update: (change: (current: T) => T) => {
      if (fixture) client.setQueryData<T>(queryKey, (current) => change(current ?? initial))
    },
  }
}

export function SettingsProviders({
  client,
  organization,
  session,
  actions,
  children,
}: {
  client: QueryClient
  organization: PlatformOrganization
  session: SessionHookResult
  actions: FixtureSettingsActions
  children: ReactNode
}) {
  return (
    <FixtureSettings.Provider value={actions}>
      <QueryClientProvider client={client}>
        <NuqsAdapter>
          <OrganizationProvider organization={organization}>
            <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
          </OrganizationProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </FixtureSettings.Provider>
  )
}
