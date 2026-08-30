/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  COPILOT_WORKFLOW_TOOL_BINDING_ERRORS,
  classifyWorkflowToolBinding,
  resolveWorkflowToolTargetId,
} from './workflow-tools'

const runningToolCall = {
  toolName: 'run_workflow',
  status: 'running' as const,
  permissionDecision: null,
  args: { workflowId: 'workflow-1' },
}

const run = { userId: 'user-1', workflowId: 'workflow-1' }

function classify(overrides: Partial<Parameters<typeof classifyWorkflowToolBinding>[0]> = {}) {
  return classifyWorkflowToolBinding({
    toolCall: runningToolCall,
    run,
    userId: 'user-1',
    workflowId: 'workflow-1',
    ...overrides,
  })
}

describe('classifyWorkflowToolBinding', () => {
  it('accepts a live call bound to the requested workflow', () => {
    expect(classify()).toEqual({ ok: true })
  })

  it.each([
    ['missing row', { toolCall: null }, COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.unknown],
    [
      'non-workflow tool',
      { toolCall: { ...runningToolCall, toolName: 'read' } },
      COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.notWorkflowTool,
    ],
    [
      'finished call',
      { toolCall: { ...runningToolCall, status: 'completed' as const } },
      COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.alreadySettled,
    ],
    [
      'unapproved call',
      { toolCall: { ...runningToolCall, status: 'pending' as const } },
      COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.awaitingPermission,
    ],
    [
      'another user',
      { run: { ...run, userId: 'someone-else' } },
      COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.foreignOwner,
    ],
    [
      'another workflow',
      { workflowId: 'workflow-2' },
      COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.workflowMismatch,
    ],
  ])('rejects %s with its own reason', (_name, overrides, expected) => {
    expect(classify(overrides)).toEqual({ ok: false, rejection: expected })
  })

  it('reports a finished call as the same conflict the execution claim uses', () => {
    // The client already treats this status/code pair as benign on both the sync
    // and async paths, so a duplicate stops rendering as a workflow failure.
    expect(COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.alreadySettled).toMatchObject({
      statusCode: 409,
      code: 'COPILOT_WORKFLOW_EXECUTION_CONFLICT',
    })
  })

  it('falls back to the run workflow only for rows persisted without a stamped target', () => {
    // Kept for the deploy window: in-flight tool calls created before the target
    // was stamped into args still resolve through the run.
    expect(resolveWorkflowToolTargetId({}, 'workflow-1')).toBe('workflow-1')
    expect(classify({ toolCall: { ...runningToolCall, args: {} } })).toEqual({ ok: true })
    // A workspace chat has no run workflow, so nothing can rescue it.
    expect(
      classify({ toolCall: { ...runningToolCall, args: {} }, run: { ...run, workflowId: null } })
    ).toEqual({ ok: false, rejection: COPILOT_WORKFLOW_TOOL_BINDING_ERRORS.workflowMismatch })
  })
})
