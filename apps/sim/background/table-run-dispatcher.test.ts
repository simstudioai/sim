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
})
