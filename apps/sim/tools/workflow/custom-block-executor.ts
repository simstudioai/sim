import type { ToolConfig } from '@/tools/types'

interface CustomBlockExecutorParams {
  /** The `custom_block_*` type to run — authority is re-resolved from it server-side. */
  blockType: string
  /** Input values keyed by the source field's stable id (assembled + LLM-filled). */
  inputMapping?: Record<string, unknown> | string
}

/**
 * Tool descriptor for running a published custom block (deploy-as-block) as an
 * Agent tool. Execution is handled server-side in `executeTool` (`tools/index.ts`)
 * via the `custom-block-tool-runner`, NOT here — so this module (imported by the
 * client-bundled tool registry) stays free of the executor/db dependency graph.
 * `request` is declared to satisfy the type but is never invoked (the executeTool
 * custom-block branch returns first).
 */
export const customBlockExecutorTool: ToolConfig<CustomBlockExecutorParams> = {
  id: 'custom_block_executor',
  name: 'Custom Block Executor',
  description: 'Execute a published custom block (a workflow packaged as a reusable block).',
  version: '1.0.0',
  params: {
    blockType: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The custom block type to execute',
    },
    inputMapping: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: "Input values for the block's fields, keyed by field id",
    },
  },
  request: {
    url: () => '',
    method: 'POST',
    headers: () => ({}),
  },
}
