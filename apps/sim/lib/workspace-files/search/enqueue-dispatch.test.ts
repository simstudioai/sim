/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  resolveRegion: vi.fn(),
  runDetached: vi.fn(),
  trigger: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: mocks.trigger } }))
vi.mock('@/background/workspace-file-search-dispatch', () => ({
  workspaceFileSearchDispatchTask: {},
}))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: mocks.resolveRegion }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: true }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: mocks.runDetached }))
vi.mock('@/lib/workspace-files/search/dispatcher', () => ({
  dispatchWorkspaceFileSearchIndexJobs: mocks.dispatch,
}))

import { enqueueWorkspaceFileSearchDispatch } from '@/lib/workspace-files/search/enqueue-dispatch'

describe('workspace file search dispatcher enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T12:34:45.000Z'))
    mocks.resolveRegion.mockResolvedValue('us-east-1')
    mocks.trigger.mockResolvedValue({ id: 'run-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits only for durable Trigger.dev acceptance and does not run the dispatcher inline', async () => {
    await expect(enqueueWorkspaceFileSearchDispatch()).resolves.toEqual({
      backend: 'trigger-dev',
      jobId: 'run-1',
    })

    expect(mocks.trigger).toHaveBeenCalledWith('workspace-file-search-dispatch', undefined, {
      idempotencyKey: 'workspace-file-search-dispatch:29800114',
      idempotencyKeyTTL: '5m',
      maxDuration: 60,
      region: 'us-east-1',
      ttl: '5m',
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.runDetached).not.toHaveBeenCalled()
  })
})
