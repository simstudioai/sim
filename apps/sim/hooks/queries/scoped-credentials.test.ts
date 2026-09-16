/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(
    (options: {
      queryKey: readonly unknown[]
      queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
      enabled: boolean
      staleTime: number
    }) => options
  ),
  request: vi.fn(),
  workspaceList: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.query }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))
vi.mock('@/hooks/queries/utils/fetch-workspace-credentials', () => ({
  fetchWorkspaceCredentialList: mocks.workspaceList,
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  oauthCredentialKeys: { lists: () => ['oauth-credentials', 'list'] },
}))
vi.mock('@/hooks/queries/utils/selector-keys', () => ({ invalidateSelectorQueries: vi.fn() }))

import { listOrganizationCredentialsContract } from '@/lib/api/contracts/organization-credentials'
import { useScopedCredentials } from '@/hooks/queries/scoped-credentials'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockResolvedValue({ credentials: [{ id: 'org-credential' }] })
  mocks.workspaceList.mockResolvedValue([{ id: 'workspace-credential' }])
})

function latestQuery() {
  const call = mocks.query.mock.calls.at(-1)
  if (!call) throw new Error('Query was not configured')
  return call[0]
}

describe('scoped credential queries', () => {
  it('loads organization credentials with exact owner, provider and cancellation', async () => {
    useScopedCredentials({ organizationId: 'org-1', type: 'service_account', providerId: 'google' })
    const signal = new AbortController().signal
    await expect(latestQuery().queryFn({ signal })).resolves.toEqual([{ id: 'org-credential' }])
    expect(mocks.request).toHaveBeenCalledWith(listOrganizationCredentialsContract, {
      query: { organizationId: 'org-1', type: 'service_account', providerId: 'google' },
      signal,
    })
    expect(mocks.workspaceList).not.toHaveBeenCalled()
  })

  it('retains the existing workspace credential query', async () => {
    useScopedCredentials({ workspaceId: 'workspace-1', type: 'oauth', providerId: 'google' })
    const signal = new AbortController().signal
    await latestQuery().queryFn({ signal })
    expect(mocks.workspaceList).toHaveBeenCalledWith('workspace-1', signal, 'oauth', 'google')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('keeps unsupported organization types separate from the full credential list cache', async () => {
    useScopedCredentials({ organizationId: 'org-1' })
    const allKey = latestQuery().queryKey
    useScopedCredentials({ organizationId: 'org-1', type: 'env_workspace' })
    expect(latestQuery().queryKey).not.toEqual(allKey)
    await expect(latestQuery().queryFn({ signal: new AbortController().signal })).resolves.toEqual(
      []
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('does not enable ownerless or explicitly disabled queries', () => {
    useScopedCredentials({ enabled: true })
    expect(latestQuery().enabled).toBe(false)
    useScopedCredentials({ organizationId: 'org-1', enabled: false })
    expect(latestQuery().enabled).toBe(false)
  })

  it('rejects ambiguous owners before registering a query', () => {
    expect(() =>
      useScopedCredentials({ workspaceId: 'workspace-1', organizationId: 'org-1' })
    ).toThrow()
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
