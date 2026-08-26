/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearSubBlocks: vi.fn(),
  clearWorkflow: vi.fn(),
  consolePersist: vi.fn(),
  executionReset: vi.fn(),
  queryClear: vi.fn(),
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => ({ clear: mocks.queryClear }),
}))
vi.mock('@/stores/execution', () => ({
  useExecutionStore: { getState: () => ({ reset: mocks.executionReset }) },
}))
vi.mock('@/stores/mothership-drafts/store', () => ({
  useMothershipDraftsStore: { setState: vi.fn() },
}))
vi.mock('@/stores/terminal', () => ({
  consolePersistence: { persist: mocks.consolePersist },
  useTerminalConsoleStore: { setState: vi.fn() },
}))
vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: { setState: vi.fn() },
}))
vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: { getState: () => ({ clear: mocks.clearSubBlocks }) },
}))
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: { getState: () => ({ clear: mocks.clearWorkflow }) },
}))

import { resetAllStores } from '@/stores'

describe('resetAllStores', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clears every server-state query on user-data reset', () => {
    resetAllStores()

    expect(mocks.queryClear).toHaveBeenCalledOnce()
  })
})
