/**
 * Semantic assertions for common test scenarios.
 *
 * @example
 * ```ts
 * import { expectBlockNotExists, expectEdgeCount } from '@sim/testing'
 *
 * expectBlockNotExists(workflow.blocks, 'agent-1')
 * expectEdgeCount(workflow, 2)
 * ```
 */

export { expectWorkflowAccessDenied } from './permission.assertions'
export { expectBlockNotExists, expectEdgeCount } from './workflow.assertions'
