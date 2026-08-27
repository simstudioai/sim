/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import { useExtractWorkspaceFile } from '@/hooks/queries/workspace-file-folders'

const { queryClient } = vi.hoisted(() => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}))

vi.mock('@sim/emcn', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  useMutation: vi.fn((options) => options),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: vi.fn() }))

const variables = { workspaceId: 'workspace-1', fileId: 'file-1', fileName: 'archive.zip' }

describe('useExtractWorkspaceFile reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates file browsers after success', () => {
    const mutation = useExtractWorkspaceFile()

    mutation.onSuccess(
      { success: true, folderName: 'archive', extractedCount: 2, skippedCount: 0 },
      variables
    )
    mutation.onSettled(undefined, undefined, variables)

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3)
  })

  it('invalidates file browsers after an API error response', () => {
    const mutation = useExtractWorkspaceFile()
    const error = new ApiClientError({ status: 409, message: 'Folder exists', body: {} })

    mutation.onError(error, variables)
    mutation.onSettled(undefined, error, variables)

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3)
  })
})
