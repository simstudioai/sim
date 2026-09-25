/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  indexWorkspaceFile: vi.fn(),
  retry: vi.fn(),
  markFailed: vi.fn(),
  task: vi.fn((config: unknown) => config),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mocks.task }))
vi.mock('@/lib/workspace-files/search/indexing', () => ({
  indexWorkspaceFileForSearch: mocks.indexWorkspaceFile,
  getWorkspaceFileSearchRetry: mocks.retry,
  markWorkspaceFileSearchIndexFailed: mocks.markFailed,
}))

import {
  FILE_SEARCH_INDEX_CAPACITY_MAX_ATTEMPTS,
  FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY,
  FILE_SEARCH_INDEX_MAX_DURATION_SECONDS,
} from '@/lib/workspace-files/search/constants'
import { workspaceFileSearchIndexTask } from '@/background/workspace-file-search-index'

const payload = {
  workspaceId: 'workspace-1',
  fileId: 'file-1',
  sourceContentUpdatedAt: '2026-08-29T12:00:00.000Z',
}

describe('workspace file search index task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses isolated medium workers with a hard global concurrency and duration cap', () => {
    expect(workspaceFileSearchIndexTask).toMatchObject({
      id: 'workspace-file-search-index',
      machine: 'medium-2x',
      maxDuration: FILE_SEARCH_INDEX_MAX_DURATION_SECONDS,
      retry: { maxAttempts: FILE_SEARCH_INDEX_CAPACITY_MAX_ATTEMPTS },
      queue: {
        name: 'workspace-file-search-index',
        concurrencyLimit: FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY,
      },
    })
  })

  it('passes the Trigger.dev abort signal to the single-revision indexer', async () => {
    const signal = new AbortController().signal
    mocks.indexWorkspaceFile.mockResolvedValue(undefined)

    await workspaceFileSearchIndexTask.run(payload, { signal })

    expect(mocks.indexWorkspaceFile).toHaveBeenCalledWith(payload, signal)
  })

  it('marks the revision failed only from the terminal onFailure hook', async () => {
    mocks.indexWorkspaceFile.mockRejectedValue(new Error('retryable parser failure'))

    await expect(
      workspaceFileSearchIndexTask.run(payload, { signal: new AbortController().signal })
    ).rejects.toThrow('retryable parser failure')
    expect(mocks.markFailed).not.toHaveBeenCalled()

    await workspaceFileSearchIndexTask.onFailure({ payload })
    expect(mocks.markFailed).toHaveBeenCalledWith(payload)
  })

  it('lets the indexing retry policy schedule each failed attempt', async () => {
    const error = new Error('statement timeout')
    const decision = { retryAt: new Date('2026-08-29T12:02:00.000Z') }
    mocks.retry.mockReturnValue(decision)

    await expect(
      workspaceFileSearchIndexTask.catchError({ error, ctx: { attempt: { number: 2 } } })
    ).resolves.toBe(decision)
    expect(mocks.retry).toHaveBeenCalledWith(error, 2)
  })
})
