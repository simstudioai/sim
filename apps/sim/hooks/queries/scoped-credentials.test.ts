import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { reactQueryMock, reactQueryMockFns } from '@sim/testing/mocks/react-query.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ workspaceList: vi.fn() }))
vi.mock('@tanstack/react-query', () => reactQueryMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/hooks/queries/utils/fetch-workspace-credentials', () => ({
  fetchWorkspaceCredentialList: mocks.workspaceList,
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  oauthCredentialKeys: { lists: () => ['oauth-credentials', 'list'] },
}))
vi.mock('@/hooks/queries/utils/selector-keys', () => ({ invalidateSelectorQueries: vi.fn() }))

import { useScopedCredentials } from '@/hooks/queries/scoped-credentials'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

interface CapturedQuery {
  queryKey: readonly unknown[]
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
  enabled: boolean
  staleTime: number
}

const mockQuery = reactQueryMockFns.mockUseQuery
mockQuery.mockImplementation((options: CapturedQuery) => options)

beforeEach(() => {
  mockRequestJson.mockResolvedValue({ credentials: [{ id: 'org-credential' }] })
  mocks.workspaceList.mockResolvedValue([{ id: 'workspace-credential' }])
})

function latestQuery() {
  const call = mockQuery.mock.calls.at(-1)
  if (!call) throw new Error('Query was not configured')
  return call[0] as CapturedQuery
}

describe('scoped credential queries', () => {
  it('keeps unsupported organization types separate from the full credential list cache', async () => {
    useScopedCredentials({ organizationId: 'org-1' })
    const allKey = latestQuery().queryKey
    useScopedCredentials({ organizationId: 'org-1', type: 'env_workspace' })
    expect(latestQuery().queryKey).not.toEqual(allKey)
    await expect(latestQuery().queryFn({ signal: new AbortController().signal })).resolves.toEqual(
      []
    )
    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('rejects ambiguous owners before registering a query', () => {
    expect(() =>
      useScopedCredentials({ workspaceId: 'workspace-1', organizationId: 'org-1' })
    ).toThrow()
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
