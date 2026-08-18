import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryClient } = vi.hoisted(() => ({
  queryClient: {
    cancelQueries: vi.fn().mockResolvedValue(undefined),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    getQueryData: vi.fn(),
    getQueriesData: vi.fn(() => []),
    setQueryData: vi.fn(),
    setQueriesData: vi.fn(),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
  useMutation: vi.fn((options) => options),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: vi.fn() }))

import { useUpdateWorkspaceCredential } from '@/hooks/queries/credentials'

const CREDENTIAL_ID = 'cred-1'

const existing = {
  id: CREDENTIAL_ID,
  workspaceId: 'workspace-1',
  type: 'env_workspace' as const,
  displayName: 'STRIPE_API_KEY',
  description: 'old description',
  providerId: null,
  accountId: null,
  envKey: 'STRIPE_API_KEY',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  role: 'admin' as const,
}

/** Replays the detail-cache updater the mutation hands to `setQueryData`. */
function detailAfterMutate(cached: typeof existing | null) {
  const detailCall = queryClient.setQueryData.mock.calls.find(
    ([key]) => Array.isArray(key) && key.includes('detail')
  )
  const updater = detailCall?.[1] as (old: unknown) => unknown
  return updater(cached)
}

describe('useUpdateWorkspaceCredential optimistic detail cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.getQueryData.mockReturnValue(existing)
    queryClient.getQueriesData.mockReturnValue([])
  })

  it('patches the detail cache so a detail-backed editor stops being dirty after save', async () => {
    const mutation = useUpdateWorkspaceCredential() as any
    await mutation.onMutate({ credentialId: CREDENTIAL_ID, description: 'new description' })

    expect(detailAfterMutate(existing)).toMatchObject({ description: 'new description' })
  })

  it('clears the detail description when the edit passes null', async () => {
    const mutation = useUpdateWorkspaceCredential() as any
    await mutation.onMutate({ credentialId: CREDENTIAL_ID, description: null })

    expect(detailAfterMutate(existing)).toMatchObject({ description: null })
  })

  it('leaves untouched fields alone when only displayName changes', async () => {
    const mutation = useUpdateWorkspaceCredential() as any
    await mutation.onMutate({ credentialId: CREDENTIAL_ID, displayName: 'RENAMED' })

    expect(detailAfterMutate(existing)).toMatchObject({
      displayName: 'RENAMED',
      description: 'old description',
    })
  })

  it('rolls the detail cache back when the update fails', async () => {
    const mutation = useUpdateWorkspaceCredential() as any
    const context = await mutation.onMutate({
      credentialId: CREDENTIAL_ID,
      description: 'new description',
    })
    queryClient.setQueryData.mockClear()

    mutation.onError(new Error('boom'), { credentialId: CREDENTIAL_ID }, context)

    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      expect.arrayContaining(['detail']),
      existing
    )
  })
})
