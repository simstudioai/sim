/**
 * Custom assertions for testing workflows and execution.
 *
 * These provide semantic, readable assertions for common test scenarios.
 *
 * @example
 * ```ts
 * import {
 *   expectBlockExists,
 *   expectEdgeConnects,
 *   expectExecutionOrder,
 * } from '@sim/testing/assertions'
 *
 * // Workflow assertions
 * expectBlockExists(workflow.blocks, 'agent-1', 'agent')
 * expectEdgeConnects(workflow.edges, 'start', 'agent-1')
 *
 * // Execution assertions
 * expectBlockExecuted(ctx, 'agent-1')
 * expectExecutionOrder(log, ['start', 'agent-1', 'end'])
 * ```
 */

// Execution assertions
export {
  expectBlockExecuted,
  expectBlockNotExecuted,
  expectBlockOutput,
  expectConditionDecision,
  expectEnvironmentVariables,
  expectExecutionCancelled,
  expectExecutionNotCancelled,
  expectExecutionOrder,
  expectInActivePath,
  expectLogCount,
  expectLoopCompleted,
} from './execution.assertions'
// Permission assertions
export {
  expectApiKeyInvalid,
  expectApiKeyValid,
  expectPermissionAllowed,
  expectPermissionDenied,
  expectRoleCannotPerform,
  expectRoleCanPerform,
  expectSocketAccessDenied,
  expectSocketAccessGranted,
  expectUserHasNoPermission,
  expectUserHasPermission,
  expectWorkflowAccessDenied,
  expectWorkflowAccessGranted,
} from './permission.assertions'
// Workflow assertions
export {
  expectBlockCount,
  expectBlockDisabled,
  expectBlockEnabled,
  expectBlockExists,
  expectBlockHasParent,
  expectBlockNotExists,
  expectBlockPosition,
  expectEdgeConnects,
  expectEdgeCount,
  expectEmptyWorkflow,
  expectLinearChain,
  expectLoopExists,
  expectNoEdgeBetween,
  expectParallelExists,
} from './workflow.assertions'
