/**
 * Builder classes for fluent test data construction.
 *
 * Use builders when you need fine-grained control over complex objects.
 *
 * @example
 * ```ts
 * import { WorkflowBuilder, ExecutionContextBuilder } from '@sim/testing/builders'
 *
 * // Build a workflow
 * const workflow = WorkflowBuilder.linear(3).build()
 *
 * // Build an execution context
 * const ctx = ExecutionContextBuilder.forWorkflow('my-wf')
 *   .withBlockState('block-1', { output: 'hello' })
 *   .build()
 * ```
 */

export { ExecutionContextBuilder } from './execution.builder'
export {
  createErrorFetch,
  createToolMockFetch,
  type TestToolConfig,
  type ToolResponse,
  ToolTester,
} from './tool-tester.builder'
export { WorkflowBuilder } from './workflow.builder'
