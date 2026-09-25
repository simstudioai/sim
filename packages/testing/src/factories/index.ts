/**
 * Factory functions for creating test fixtures.
 *
 * Use these to create mock data with sensible defaults.
 * All functions allow overriding any field.
 *
 * @example
 * ```ts
 * import { createAgentBlock, createExecutionContext } from '@sim/testing/factories'
 *
 * const agent = createAgentBlock({ id: 'my-agent', position: { x: 100, y: 200 } })
 * const ctx = createExecutionContext({ workflowId: 'test' })
 * ```
 */

// Block factories
export {
  type BlockFactoryOptions,
  createAgentBlock,
  createApiBlock,
  createBlock,
  createFunctionBlock,
  createLoopBlock,
  createParallelBlock,
  createStarterBlock,
} from './block.factory'
// Edge factories
export { createEdge } from './edge.factory'
// Execution factories
export { createExecutionContext } from './execution.factory'
// Executor context factories (for executor tests)
export { createExecutorContext } from './executor-context.factory'
// Permission factories
export {
  createSession,
  createWorkflowRecord,
} from './permission.factory'
// Serialized block factories (for executor tests)
export {
  createSerializedBlock,
  createSerializedWorkflow,
} from './serialized-block.factory'
export {
  createTableDefinition,
  type TableDefinitionFactoryOptions,
} from './table.factory'
// Tool mock responses
export { mockHttpResponses } from './tool-responses.factory'
// Undo/redo operation factories
export {
  createAddBlockEntry,
  createBatchRemoveEdgesEntry,
  createMoveBlockEntry,
  createRemoveBlockEntry,
  createUpdateParentEntry,
} from './undo-redo.factory'
export {
  createComplexWorkflowState,
  createConditionalWorkflowState,
  createLoopWorkflowState,
  createMinimalWorkflowState,
  createWorkflowState,
} from './workflow.factory'
