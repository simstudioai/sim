/**
 * Factory functions for creating test fixtures.
 *
 * Use these to create mock data with sensible defaults.
 * All functions allow overriding any field.
 *
 * @example
 * ```ts
 * import {
 *   createBlock,
 *   createStarterBlock,
 *   createAgentBlock,
 *   createLinearWorkflow,
 *   createExecutionContext,
 * } from '@sim/testing/factories'
 *
 * // Create a simple workflow
 * const workflow = createLinearWorkflow(3)
 *
 * // Create a specific block
 * const agent = createAgentBlock({ id: 'my-agent', position: { x: 100, y: 200 } })
 *
 * // Create execution context
 * const ctx = createExecutionContext({ workflowId: 'test' })
 * ```
 */

// Block factories
export {
  type BlockFactoryOptions,
  createAgentBlock,
  createApiBlock,
  createBlock,
  createConditionBlock,
  createFunctionBlock,
  createKnowledgeBlock,
  createLoopBlock,
  createParallelBlock,
  createResponseBlock,
  createRouterBlock,
  createStarterBlock,
  createWebhookBlock,
} from './block.factory'
// DAG factories (for executor DAG tests)
export {
  addNodeToDAG,
  connectDAGNodes,
  createDAG,
  createDAGFromNodes,
  createDAGNode,
  createLinearDAG,
  type DAG,
  type DAGEdge,
  type DAGNode,
  type DAGNodeFactoryOptions,
} from './dag.factory'
// Edge factories
export { createEdge, createEdges, createLinearEdges, type EdgeFactoryOptions } from './edge.factory'
// Execution factories
export {
  createCancelledExecutionContext,
  createExecutionContext,
  createExecutionContextWithStates,
  createTimedExecutionContext,
  type ExecutionContextFactoryOptions,
} from './execution.factory'
// Executor context factories (for executor tests)
export {
  addBlockState,
  createExecutorContext,
  createExecutorContextWithBlocks,
  createMinimalWorkflow,
  type ExecutorBlockState,
  type ExecutorContext,
  type ExecutorContextFactoryOptions,
} from './executor-context.factory'
// Permission factories
export {
  createAdminPermission,
  createEncryptedApiKey,
  createLegacyApiKey,
  createPermission,
  createReadPermission,
  createSession,
  createWorkflowAccessContext,
  createWorkflowRecord,
  createWorkspaceRecord,
  createWritePermission,
  type EntityType,
  type MockSession,
  type Permission,
  type PermissionFactoryOptions,
  type PermissionType,
  ROLE_ALLOWED_OPERATIONS,
  type SessionFactoryOptions,
  SOCKET_OPERATIONS,
  type SocketOperation,
  type WorkflowAccessContext,
  type WorkflowRecord,
  type WorkflowRecordFactoryOptions,
  type WorkspaceRecord,
  type WorkspaceRecordFactoryOptions,
} from './permission.factory'
// Serialized block factories (for executor tests)
export {
  createSerializedAgentBlock,
  createSerializedBlock,
  createSerializedConditionBlock,
  createSerializedConnection,
  createSerializedEvaluatorBlock,
  createSerializedFunctionBlock,
  createSerializedRouterBlock,
  createSerializedStarterBlock,
  createSerializedWorkflow,
  resetSerializedBlockCounter,
  type SerializedBlock,
  type SerializedBlockFactoryOptions,
  type SerializedConnection,
  type SerializedWorkflow,
} from './serialized-block.factory'
// Tool mock responses
export {
  mockDriveResponses,
  mockGitHubResponses,
  mockGmailResponses,
  mockHttpResponses,
  mockPineconeResponses,
  mockSerperResponses,
  mockSheetsResponses,
  mockSlackResponses,
  mockSupabaseResponses,
  mockTavilyResponses,
} from './tool-responses.factory'
// Undo/redo operation factories
export {
  type BaseOperation,
  type BatchAddBlocksOperation,
  type BatchAddEdgesOperation,
  type BatchMoveBlocksOperation,
  type BatchRemoveBlocksOperation,
  type BatchRemoveEdgesOperation,
  type BatchUpdateParentOperation,
  createAddBlockEntry,
  createAddEdgeEntry,
  createBatchRemoveEdgesEntry,
  createBatchUpdateParentEntry,
  createMoveBlockEntry,
  createRemoveBlockEntry,
  createUpdateParentEntry,
  type Operation,
  type OperationEntry,
  type OperationType,
  type UpdateParentOperation,
} from './undo-redo.factory'
export {
  createUser,
  createUserWithWorkspace,
  createWorkflow,
  createWorkspace,
  type UserFactoryOptions,
  type WorkflowObjectFactoryOptions,
  type WorkspaceFactoryOptions,
} from './user.factory'
export {
  createAgentWithToolsWorkflowState,
  createBranchingWorkflow,
  createComplexWorkflowState,
  createConditionalWorkflowState,
  createInvalidSerializedWorkflow,
  createInvalidWorkflowState,
  createLinearWorkflow,
  createLoopWorkflow,
  createLoopWorkflowState,
  createMinimalWorkflowState,
  createMissingMetadataWorkflow,
  createParallelWorkflow,
  createWorkflowState,
  type WorkflowFactoryOptions,
  type WorkflowStateFixture,
} from './workflow.factory'
