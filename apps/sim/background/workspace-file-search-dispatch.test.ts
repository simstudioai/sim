/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  task: vi.fn((config: unknown) => config),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mocks.task }))
vi.mock('@/lib/workspace-files/search/dispatcher', () => ({
  dispatchWorkspaceFileSearchIndexJobs: mocks.dispatch,
}))

import { FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS } from '@/lib/workspace-files/search/constants'
import { workspaceFileSearchDispatchTask } from '@/background/workspace-file-search-dispatch'

describe('workspace file search dispatch task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('serializes bounded dispatcher runs outside the cron request', async () => {
    expect(workspaceFileSearchDispatchTask).toMatchObject({
      id: 'workspace-file-search-dispatch',
      machine: 'small-1x',
      maxDuration: FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS,
      retry: { maxAttempts: 3 },
      queue: {
        name: 'workspace-file-search-dispatch',
        concurrencyLimit: 1,
      },
    })

    mocks.dispatch.mockResolvedValue({
      dispatchedFiles: 2,
      backfilledFiles: 1000,
      reapedClaims: 0,
      lockAcquired: true,
    })
    await workspaceFileSearchDispatchTask.run()
    expect(mocks.dispatch).toHaveBeenCalledOnce()
  })
})
