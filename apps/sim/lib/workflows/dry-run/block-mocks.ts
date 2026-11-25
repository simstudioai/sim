import type { ExecutionTestHooks } from '@/executor/execution/types'
import type { NormalizedBlockOutput } from '@/executor/types'

/**
 * Test hooks that answer each block in `outputs` (keyed by workflow block id) with its output
 * instead of running its handler (`run.mocks`). Normalization, logging and edges run as for any
 * mocked block. Child workflows inherit the hooks, where these ids name no block.
 */
export function createBlockMockHooks(
  outputs: ReadonlyMap<string, NormalizedBlockOutput>
): ExecutionTestHooks {
  return {
    enterWorkflow: async () => {},
    mocksBlock: (blockId) => outputs.has(blockId),
    resolveMock: async (call) => {
      const output = outputs.get(call.blockId)
      if (!output) throw new Error(`Block ${call.blockName} has no mock`)
      return output
    },
    mocksTool: () => false,
    resolveToolMock: async (call) => {
      throw new Error(`Tool ${call.toolId} has no mock`)
    },
    spiesBlock: () => false,
    recordSpy: () => {},
  }
}
