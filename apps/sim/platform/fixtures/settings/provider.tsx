'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { QueryClient } from '@tanstack/react-query'
import type { Scenario } from '@/platform/fixtures'
import { accountFixture } from '@/platform/fixtures/settings/account'
import { billingFixture, setSubscriptionCancellation } from '@/platform/fixtures/settings/billing'
import { deletedChatsFixture } from '@/platform/fixtures/settings/deleted-chats'
import { drainsFixture } from '@/platform/fixtures/settings/drains'
import { generalFixture } from '@/platform/fixtures/settings/general'
import { governanceFixture } from '@/platform/fixtures/settings/governance'
import { insightsFixture } from '@/platform/fixtures/settings/insights'
import { knowledgeGraphsFixture } from '@/platform/fixtures/settings/knowledge-graphs'
import { membersFixture } from '@/platform/fixtures/settings/members'
import { generateSampleLicense, mothershipFixture } from '@/platform/fixtures/settings/mothership'
import { organizationFixture, settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import { permissionGroupsFixture } from '@/platform/fixtures/settings/permission-groups'
import { requestsFixture } from '@/platform/fixtures/settings/requests'
import { ssoFixture } from '@/platform/fixtures/settings/sso'
import {
  createSettingsFixture,
  type SettingsFixtureProfile,
  type SettingsFixtureState,
} from '@/platform/fixtures/settings/state'
import { readBrandImage } from '@/platform/fixtures/settings/whitelabeling'
import { refreshMothershipLicenses } from '@/platform/lib/data/mothership-admin'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { SettingsProviders } from '@/platform/lib/data/settings-providers'
import type { PreviewPlan } from '@/platform/lib/navigation'

const sessions = new Map<string, { client: QueryClient; state: SettingsFixtureState }>()

async function respondToFixtureRequest(
  request: Request,
  path: string,
  state: SettingsFixtureState
) {
  for (const handle of [
    billingFixture,
    ssoFixture,
    generalFixture,
    knowledgeGraphsFixture,
    accountFixture,
    deletedChatsFixture,
    requestsFixture,
    membersFixture,
    mothershipFixture,
    organizationFixture,
    permissionGroupsFixture,
    drainsFixture,
    governanceFixture,
    insightsFixture,
  ]) {
    const result = await handle(request, path, state)
    if (result instanceof Response) return result
    if (result !== undefined) return Response.json(result)
  }
  return Response.json({ error: 'Could not load this setting.' }, { status: 404 })
}

let activeTransport: { state: SettingsFixtureState } | null | undefined

/** Keep delayed requests inside the fixture document even after the last Settings section unmounts. */
function installTransport(state: SettingsFixtureState) {
  if (activeTransport === undefined) {
    const previous = window.fetch
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        window.location.href
      )
      if (!url.pathname.startsWith('/api/')) return previous.call(window, input, init)
      if (!activeTransport) return Response.json({ error: 'Settings is closed.' }, { status: 503 })
      const request = new Request(input instanceof Request ? input : url, init)
      return respondToFixtureRequest(request, url.pathname, activeTransport.state)
    }
  }
  const owner = { state }
  activeTransport = owner
  return () => {
    if (activeTransport === owner) activeTransport = null
  }
}

export interface SettingsFixtureProviderProps {
  scenario: Scenario
  plan: PreviewPlan
  organization: PlatformOrganization
  referenceTime: number
  profile: SettingsFixtureProfile
  children: ReactNode
}

export function SettingsFixtureProvider({
  scenario,
  plan,
  organization,
  profile,
  referenceTime,
  children,
}: SettingsFixtureProviderProps) {
  const [mounted, setMounted] = useState<ReturnType<typeof sessions.get>>()
  useEffect(() => {
    const key = `${scenario}/${plan}`
    const entry = sessions.get(key) ?? {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
      state: createSettingsFixture(
        scenario,
        plan,
        organization.organization.id,
        profile,
        referenceTime
      ),
    }
    sessions.set(key, entry)
    const restore = installTransport(entry.state)
    setMounted(entry)
    return restore
  }, [
    scenario,
    plan,
    organization.organization.id,
    profile.id,
    profile.name,
    profile.email,
    profile.image,
    referenceTime,
  ])
  if (!mounted || mounted.state.scenario !== scenario || mounted.state.plan !== plan) return null
  const session = {
    data: {
      user: mounted.state.general.profile,
      session: { userId: profile.id, activeOrganizationId: organization.organization.id },
    },
    isPending: false,
    error: null,
    refetch: async () => {},
  }
  return (
    <SettingsProviders
      client={mounted.client}
      organization={organization}
      session={session}
      actions={{
        referenceTime,
        uploadBrandImage: readBrandImage,
        previewByokWorkspaces: settingsWorkspaces.map((workspace, index) => ({
          ...workspace,
          keySource: index === 0 ? 'Workspace key' : 'Inherited from the organization',
        })),
        generateSampleLicense: (env, draft) => {
          const sample = generateSampleLicense(mounted.state, env, draft)
          void refreshMothershipLicenses(mounted.client, env)
          return sample
        },
        setSubscriptionCancellation: (cancelled) =>
          setSubscriptionCancellation(mounted.state, cancelled),
      }}
    >
      {children}
    </SettingsProviders>
  )
}
