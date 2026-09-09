/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectGitHubSearchInstallationContract,
  listGitHubSearchInstallationsContract,
} from '@/lib/api/contracts/knowledge/github-installations'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import {
  githubSearchInstallationKeys,
  useConnectGitHubSearchInstallation,
  useGitHubSearchInstallations,
} from '@/hooks/queries/github-search-installations'
import { oauthCredentialKeys } from '@/hooks/queries/oauth/oauth-credentials'

let root: Root
let queryClient: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.createElement('div'))
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  queryClient.clear()
})

describe('GitHub installation queries', () => {
  it('forwards cancellation and keeps installations scoped to the organization', async () => {
    mocks.requestJson.mockResolvedValue({
      success: true,
      available: false,
      installUrl: null,
      needsUserConnection: false,
      installations: [],
    })
    function Probe() {
      useGitHubSearchInstallations('org-1')
      return null
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    )
    expect(mocks.requestJson).toHaveBeenCalledWith(listGitHubSearchInstallationsContract, {
      query: { organizationId: 'org-1' },
      signal: expect.any(AbortSignal),
    })
    expect(queryClient.getQueryData(githubSearchInstallationKeys.list('org-1'))).toBeDefined()
    expect(queryClient.getQueryData(githubSearchInstallationKeys.list('org-2'))).toBeUndefined()
  })

  it('does not list installations without an organization', async () => {
    function Probe() {
      useGitHubSearchInstallations()
      return null
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    )
    expect(mocks.requestJson).not.toHaveBeenCalled()
  })

  it('refreshes the selected organization credential picker after connecting', async () => {
    const ownKey = oauthCredentialKeys.list('github-repositories', '', '', 'org-1')
    const otherKey = oauthCredentialKeys.list('github-repositories', '', '', 'org-2')
    const installationsKey = githubSearchInstallationKeys.list('org-1')
    for (const key of [ownKey, otherKey, installationsKey]) queryClient.setQueryData(key, [])
    mocks.requestJson.mockResolvedValue({
      success: true,
      credential: { id: 'cred-1', displayName: 'acme' },
    })
    let mutation: ReturnType<typeof useConnectGitHubSearchInstallation> | undefined
    function Probe() {
      mutation = useConnectGitHubSearchInstallation()
      return null
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    )
    await act(async () => {
      await mutation!.mutateAsync({ organizationId: 'org-1', installationId: '123' })
    })
    expect(mocks.requestJson).toHaveBeenCalledWith(connectGitHubSearchInstallationContract, {
      body: { organizationId: 'org-1', installationId: '123' },
    })
    expect(queryClient.getQueryState(ownKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(installationsKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false)
  })
})
