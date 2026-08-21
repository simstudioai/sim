/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockTask } = vi.hoisted(() => ({
  mockTask: vi.fn((config) => config),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))
vi.mock('@/lib/table/dispatcher', () => ({
  runDispatcherToCompletion: vi.fn(),
}))

import { tableRunDispatcherTask } from '@/background/table-run-dispatcher'

describe('table-run-dispatcher task configuration', () => {
  /**
   * Peak RSS is a flat 457-464 MB plateau independent of run length, and it has
   * crept ~2% per release — 446 MB in late July to 545 MB, past the 512 MiB
   * `small-1x` ceiling, which killed four runs in one afternoon.
   */
  it('runs on a preset whose memory clears the observed plateau', () => {
    expect(tableRunDispatcherTask.machine).toBe('small-2x')
  })

  /**
   * `maxAttempts` alone does NOT cover `TASK_PROCESS_OOM_KILLED` — Trigger.dev
   * retries an OOM only when `retry.outOfMemory.machine` names a larger preset.
   * Every one of the four killed runs recorded `attempt_count = 1`, so the
   * documented "retries and resumes from the persisted cursor" never happened.
   */
  it('escalates to a larger machine on an out-of-memory kill', () => {
    expect(tableRunDispatcherTask.retry?.outOfMemory?.machine).toBe('medium-1x')
    expect(tableRunDispatcherTask.retry?.maxAttempts).toBe(3)
  })
})
