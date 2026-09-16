/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readGitHubSearchSetupContract,
  startGitHubSearchSetupContract,
} from '@/lib/api/contracts/knowledge/github-setup'
import {
  listOrganizationCredentialsContract,
  listOrganizationOAuthCredentialsContract,
} from '@/lib/api/contracts/organization-credentials'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(contract: unknown, input: RequestInput) => Promise<unknown>>(),
  connected: vi.fn(),
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))
vi.mock('@/hooks/queries/credentials', () => ({ useWorkspaceCredential: vi.fn() }))

import { oauthCredentialKeys, useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useGitHubInstallationSetup } from '@/hooks/use-github-installation-setup'

interface RequestInput {
  query?: { organizationId?: string; purpose?: string }
}

describe('GitHub setup credential cache reconciliation', () => {
  let root: Root
  let client: QueryClient
  let setup: ReturnType<typeof useGitHubInstallationSetup>
  let indexing: ReturnType<typeof useOAuthCredentials>
  let browsing: ReturnType<typeof useOAuthCredentials>
  let unrelated: ReturnType<typeof useOAuthCredentials>
  let completed: boolean
  let channels: Array<{ onmessage: ((event: MessageEvent<unknown>) => void) | null }>

  function Probe() {
    indexing = useOAuthCredentials('github-repositories', { organizationId: 'org-1' })
    browsing = useOAuthCredentials('github-repositories', {
      organizationId: 'org-1',
      purpose: 'browsing',
    })
    unrelated = useOAuthCredentials('github-repositories', { organizationId: 'org-2' })
    setup = useGitHubInstallationSetup({
      organizationId: 'org-1',
      onConnected: mocks.connected,
    })
    return null
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
  }

  function accountRequests(organizationId: string) {
    return mocks.request.mock.calls.filter(
      ([contract, input]: [unknown, RequestInput]) =>
        contract === listOrganizationCredentialsContract &&
        input.query?.organizationId === organizationId
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.request.mockReset()
    mocks.connected.mockReset()
    completed = false
    channels = []
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage = null
        close = vi.fn()
        constructor() {
          channels.push(this)
        }
      }
    )
    const tab = { opener: {}, location: { href: 'about:blank' }, focus: vi.fn(), close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    mocks.request.mockImplementation(async (contract: unknown, input: RequestInput) => {
      if (contract === listOrganizationOAuthCredentialsContract) return { credentials: [] }
      if (contract === listOrganizationCredentialsContract) {
        const organizationId = input.query?.organizationId
        return {
          credentials: [
            {
              id: `${organizationId}-existing`,
              displayName: 'Existing installation',
              providerId: 'github-app-installation',
            },
            ...(completed && organizationId === 'org-1'
              ? [
                  {
                    id: 'installation-new',
                    displayName: 'New organization',
                    providerId: 'github-app-installation',
                  },
                ]
              : []),
          ],
        }
      }
      if (contract === startGitHubSearchSetupContract)
        return { success: true, url: 'https://github.com/apps/sim/installations/new' }
      if (contract === readGitHubSearchSetupContract)
        return {
          success: true,
          data: completed
            ? {
                status: 'completed',
                credential: { id: 'installation-new', displayName: 'New organization' },
              }
            : { status: 'pending' },
        }
      throw new Error('Unexpected request')
    })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root = createRoot(document.createElement('div'))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('refreshes mounted Add and Settings lists on completion without a visibility event', async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    )
    await flush()
    expect(indexing.data?.map(({ id }) => id)).toEqual(['org-1-existing'])
    expect(browsing.data?.map(({ id }) => id)).toEqual(['org-1-existing'])
    expect(accountRequests('org-1')).toHaveLength(2)
    expect(accountRequests('org-2')).toHaveLength(1)

    await act(async () => setup.connect())
    await flush()
    expect(setup.pending).toBe(true)
    completed = true
    await act(async () => {
      channels[0].onmessage?.({ data: 'connected' } as MessageEvent<unknown>)
    })
    await flush()
    await flush()

    expect(mocks.connected).toHaveBeenCalledExactlyOnceWith('installation-new')
    expect(setup.pending).toBe(false)
    expect(indexing.data?.map(({ id }) => id)).toEqual(['org-1-existing', 'installation-new'])
    expect(browsing.data?.map(({ id }) => id)).toEqual(['org-1-existing', 'installation-new'])
    expect(accountRequests('org-1')).toHaveLength(4)
    expect(accountRequests('org-2')).toHaveLength(1)
    expect(unrelated.data?.map(({ id }) => id)).toEqual(['org-2-existing'])
    expect(
      client.getQueryData(oauthCredentialKeys.list('github-repositories', '', '', 'org-1'))
    ).toEqual(indexing.data)
    expect(
      client.getQueryData(
        oauthCredentialKeys.list('github-repositories', '', '', 'org-1', 'browsing')
      )
    ).toEqual(browsing.data)
  })
})
