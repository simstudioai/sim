/**
 * @vitest-environment jsdom
 *
 * Failure modes at Home's read boundary: a widget the viewer hid reading their mailbox because the
 * session has not said who they are, a preference written under no viewer, and a workspace list
 * still on its way reading as a viewer with no workspaces.
 */
import { act } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => ({
  useFeatureFlag: () => false,
}))
vi.mock('@/platform/lib/data/integrations', () => ({
  useIntegrationActions: () => ({
    connecting: false,
    connect: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }),
}))

import { useLiveHome } from '@/platform/lib/data/home'
import { renderDataHook, unmountDataHooks } from '@/platform/lib/render-hook.test-support'
import { useOrganizationHomeStore } from '@/stores/organization-home/store'

const ORGANIZATION = {
  organization: { id: 'org-1', name: 'Org', logo: null },
  viewer: { isAdmin: false, canConnectSearchIntegrations: true, canUseSearchMcp: false },
  searchAccess: { memberScoped: true },
  connectedAccountsAvailable: true,
  settingsFeatures: { hosted: true, billingEnabled: true },
}

const ACCOUNTS = {
  credentialGroup: null,
  assistantProviders: ['gmail', 'google-calendar'],
  availableProviders: ['google-email', 'google-calendar'],
  availableMcpConnectors: [],
  viewerMcpAccounts: [],
  viewerAccounts: [
    {
      credentialId: 'mail',
      displayName: 'mail@example.com',
      providerId: 'google-email',
      groupId: 'group',
      optionId: 'option',
      status: 'active',
    },
    {
      credentialId: 'calendar',
      displayName: 'calendar@example.com',
      providerId: 'google-calendar',
      groupId: 'group',
      optionId: 'option',
      status: 'active',
    },
  ],
}

const RESPONSES: Record<string, unknown> = {
  '/api/organizations/[id]/connected-accounts': ACCOUNTS,
  '/api/knowledge/sim-search/integrations': { data: [] },
  '/api/organizations/[id]/search/history': { sources: [] },
  '/api/mothership/chats': { data: [] },
  '/api/workspaces': {
    workspaces: [{ id: 'ws-1', name: 'One', organizationId: 'org-1' }],
    pinnedWorkspaceIds: [],
  },
  '/api/organizations/[id]/home/email': { accounts: [], threads: [] },
  '/api/organizations/[id]/home/calendar': {
    accounts: [],
    events: [],
    window: { startAt: '2026-11-05T00:00:00.000Z', endAt: '2026-11-06T00:00:00.000Z' },
  },
  '/api/organizations/[id]/home/workspace-activity': { workspaces: [] },
}

function requestedPaths(): string[] {
  return apiClientRequestMockFns.mockRequestJson.mock.calls.map(([contract]) => contract.path)
}

const WIDGET_READS = [
  '/api/organizations/[id]/home/email',
  '/api/organizations/[id]/home/calendar',
  '/api/organizations/[id]/home/workspace-activity',
]

function setSession(session: { user: { id: string } } | null, isPending = false) {
  authClientMockFns.mockUseSession.mockReturnValue({ data: session, isPending })
}

function render() {
  return renderDataHook(() => useLiveHome(false))
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => queueMicrotask(resolve))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('useLiveHome', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    useOrganizationHomeStore.setState({ hiddenWidgets: {} })
    organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue(ORGANIZATION)
    apiClientRequestMockFns.mockRequestJson.mockImplementation(
      async (contract: { path: string }) => RESPONSES[contract.path] ?? {}
    )
  })
  afterEach(async () => {
    await unmountDataHooks()
    vi.useRealTimers()
  })

  describe('while the session has not said who the viewer is', () => {
    beforeEach(() => setSession(null, true))

    it('asks no provider for a widget the viewer may have hidden', async () => {
      await render()
      await settle()

      const paths = requestedPaths()
      expect(paths).toContain('/api/organizations/[id]/connected-accounts')
      expect(paths).toContain('/api/workspaces')
      for (const read of WIDGET_READS) expect(paths).not.toContain(read)
    })

    it('still paints every widget as loading rather than removing it', async () => {
      const { result } = await render()
      await settle()

      expect(result.current.view.hiddenWidgets).toEqual([])
      expect(result.current.view.email.status).toBe('loading')
      expect(result.current.view.calendar).toMatchObject({
        status: 'ready',
        data: { status: 'loading' },
      })
    })

    it('writes no preference under an unknown viewer', async () => {
      const { result } = await render()
      await settle()

      act(() => result.current.actions.setWidgetHidden('Email', true))

      expect(useOrganizationHomeStore.getState().hiddenWidgets).toEqual({})
    })
  })

  it('reads only what the settled viewer left visible, and writes under their own key', async () => {
    useOrganizationHomeStore.setState({
      hiddenWidgets: { 'user-1:org-1': ['Email', 'Calendar'] },
    })
    setSession(null, true)
    const { result, rerender } = await render()
    await settle()

    setSession({ user: { id: 'user-1' } })
    await rerender()
    await settle()

    const paths = requestedPaths()
    expect(paths).not.toContain('/api/organizations/[id]/home/email')
    expect(paths).not.toContain('/api/organizations/[id]/home/calendar')
    expect(paths).toContain('/api/organizations/[id]/home/workspace-activity')
    expect(result.current.view.hiddenWidgets).toEqual(['Email', 'Calendar'])

    act(() => result.current.actions.setWidgetHidden('Workspaces', true))
    expect(useOrganizationHomeStore.getState().hiddenWidgets['user-1:org-1']).toContain(
      'Workspaces'
    )
  })

  it('reads a visible widget once the viewer is known', async () => {
    setSession({ user: { id: 'user-1' } })
    await render()
    await settle()

    const paths = requestedPaths()
    for (const read of WIDGET_READS) expect(paths).toContain(read)
  })

  it('shows workspaces as loading until the list answers, not as none', async () => {
    setSession({ user: { id: 'user-1' } })
    const answer: { resolve: (value: unknown) => void } = { resolve: () => {} }
    apiClientRequestMockFns.mockRequestJson.mockImplementation((contract: { path: string }) =>
      contract.path === '/api/workspaces'
        ? new Promise((resolve) => {
            answer.resolve = resolve
          })
        : Promise.resolve(RESPONSES[contract.path] ?? {})
    )
    const { result } = await render()
    await settle()

    expect(result.current.view.workspaces).toEqual({ status: 'loading' })

    await act(async () => answer.resolve({ workspaces: [], pinnedWorkspaceIds: [] }))
    await settle()

    expect(result.current.view.workspaces).toEqual({ status: 'ready', items: [] })
  })
})
