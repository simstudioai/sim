/**
 * @vitest-environment jsdom
 *
 * The Platform root mounts its own providers, not the site root's, so the session's side effects
 * must hold there too. Failure modes: a checkout that returns to a Platform page with
 * `?upgraded=true` never re-reading the session past Better Auth's cookie cache (the plan stays
 * stale), and a Platform viewer never identified to PostHog.
 */

import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { type DehydratedState, dehydrate, QueryClient } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const posthog = vi.hoisted(() => ({
  identify: vi.fn(),
  reset: vi.fn(),
  startSessionRecording: vi.fn(),
  sessionRecordingStarted: vi.fn(() => true),
}))

vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('posthog-js', () => ({ default: posthog }))

import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { LiveProviders } from '@/platform/lib/data/providers'

const ORGANIZATION_ID = 'org-plan'
const SESSION = {
  user: { id: 'viewer-plan', email: 'plan@example.com', name: 'Pat Plan', image: null },
  session: { id: 'session-plan', userId: 'viewer-plan', activeOrganizationId: ORGANIZATION_ID },
}

const SURFACE = {
  organization: { id: ORGANIZATION_ID, name: 'Org', slug: 'org', logo: null, memberCount: 1 },
  routePrefix: `/o/${ORGANIZATION_ID}`,
  viewer: {
    role: 'owner',
    isAdmin: true,
    canInviteMembers: true,
    canConnectSearchIntegrations: true,
    canUsePersonalApiKeys: true,
    canUseSearchMcp: false,
  },
  mothershipAvailable: false,
  searchAccess: { sourceMirrored: false, memberScoped: false },
  connectedAccountsAvailable: false,
  settingsFeatures: {
    billingEnabled: true,
    hasEnterprisePlan: false,
    governanceActive: false,
    hosted: true,
    selfHosted: {},
    personal: false,
  },
  deployment: {
    hosted: true,
    billingEnabled: true,
    chatEnabled: true,
    azureConfigured: false,
    cohereConfigured: false,
    invitationsDisabled: false,
    features: {
      accessControl: false,
      auditLogs: false,
      customBlocks: false,
      dataDrains: false,
      dataRetention: false,
      inbox: false,
      sandboxes: false,
      scim: false,
      sessionPolicies: false,
      sso: false,
      usageMonitoring: false,
      whitelabeling: false,
    },
  },
  navFlags: {
    people: false,
    simLinks: false,
    benchmark: false,
    platformAdmin: false,
    anonymous: false,
  },
  featureFlags: {
    dashboards: false,
    'workflow-tests': false,
    changelog: false,
    'mothership-model-selector': false,
    'mothership-computer-use': false,
    'mothership-plan-mode': false,
    'mothership-memory-spaces': false,
    projects: false,
  },
  settingsSections: [],
} satisfies PlatformOrganization

/** The session entry `prefetchShell` seeds, under the key the session query reads. */
function seededSession(): DehydratedState {
  const client = new QueryClient()
  client.setQueryData(['session', 'detail'], SESSION)
  return dehydrate(client)
}

const roots: Root[] = []

async function mountPlatformRoot() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => {
    root.render(
      <LiveProviders
        organization={SURFACE}
        navigation={{ destinations: [], settingsNavigation: [] }}
        dehydratedState={seededSession()}
      >
        {null}
      </LiveProviders>
    )
  })
  await act(flushMacrotask)
}

beforeEach(() => {
  nextNavigationMockFns.mockUsePathname.mockReturnValue(`/o/${ORGANIZATION_ID}/settings`)
  authClientMockFns.mockClient.getSession.mockResolvedValue({ data: SESSION })
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {}))
  )
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  window.history.replaceState({}, '', '/')
})

it('reconciles a checkout that returns to a Platform page', async () => {
  window.history.replaceState(
    {},
    '',
    `/o/${ORGANIZATION_ID}/settings?section=billing&upgraded=true`
  )

  await mountPlatformRoot()

  expect(authClientMockFns.mockClient.getSession).toHaveBeenCalledWith({
    query: { disableCookieCache: true },
  })
  expect(window.location.search).toBe('?section=billing')
})

it('identifies the Platform viewer to PostHog', async () => {
  await mountPlatformRoot()

  expect(posthog.identify).toHaveBeenCalledWith(
    'viewer-plan',
    expect.objectContaining({ email: 'plan@example.com' })
  )
})
