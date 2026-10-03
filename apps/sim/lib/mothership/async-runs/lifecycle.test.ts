import { describe, expect, it } from 'vitest'
import { ASYNC_TOOL_STATUS, isWorkflowToolExecutionClaimable } from './lifecycle'

describe('async tool lifecycle helpers', () => {
  it('claims only dispatched or explicitly approved workflow calls', () => {
    expect(isWorkflowToolExecutionClaimable(ASYNC_TOOL_STATUS.running, null)).toBe(true)
    expect(isWorkflowToolExecutionClaimable(ASYNC_TOOL_STATUS.delivered, null)).toBe(true)
    expect(isWorkflowToolExecutionClaimable(ASYNC_TOOL_STATUS.pending, 'allow')).toBe(true)
    expect(isWorkflowToolExecutionClaimable(ASYNC_TOOL_STATUS.pending, 'allow_chat')).toBe(true)
    expect(isWorkflowToolExecutionClaimable(ASYNC_TOOL_STATUS.pending, 'always_allow')).toBe(true)
    expect(isWorkflowToolExecutionClaimable(ASYNC_TOOL_STATUS.pending, 'skip')).toBe(false)
    expect(isWorkflowToolExecutionClaimable(ASYNC_TOOL_STATUS.pending, null)).toBe(false)
    expect(isWorkflowToolExecutionClaimable(ASYNC_TOOL_STATUS.completed, 'allow')).toBe(false)
  })
})
