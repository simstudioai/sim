/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  ASYNC_TOOL_STATUS,
  isAsyncEphemeralConfirmationStatus,
  isAsyncTerminalConfirmationStatus,
  isDeliveredAsyncStatus,
  isTerminalAsyncStatus,
  isWorkflowToolExecutionClaimable,
} from './lifecycle'

describe('async tool lifecycle helpers', () => {
  it('treats only completed, failed, and cancelled as terminal execution states', () => {
    expect(isTerminalAsyncStatus(ASYNC_TOOL_STATUS.pending)).toBe(false)
    expect(isTerminalAsyncStatus(ASYNC_TOOL_STATUS.running)).toBe(false)
    expect(isTerminalAsyncStatus(ASYNC_TOOL_STATUS.completed)).toBe(true)
    expect(isTerminalAsyncStatus(ASYNC_TOOL_STATUS.failed)).toBe(true)
    expect(isTerminalAsyncStatus(ASYNC_TOOL_STATUS.cancelled)).toBe(true)
    expect(isTerminalAsyncStatus(ASYNC_TOOL_STATUS.delivered)).toBe(false)
  })

  it('treats delivered rows as distinct from terminal execution states', () => {
    expect(isDeliveredAsyncStatus(ASYNC_TOOL_STATUS.delivered)).toBe(true)
  })

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

  it('distinguishes background from terminal completion statuses', () => {
    expect(isAsyncEphemeralConfirmationStatus(ASYNC_TOOL_CONFIRMATION_STATUS.background)).toBe(true)
    expect(isAsyncEphemeralConfirmationStatus(ASYNC_TOOL_CONFIRMATION_STATUS.success)).toBe(false)

    expect(isAsyncTerminalConfirmationStatus(ASYNC_TOOL_CONFIRMATION_STATUS.success)).toBe(true)
    expect(isAsyncTerminalConfirmationStatus(ASYNC_TOOL_CONFIRMATION_STATUS.error)).toBe(true)
    expect(isAsyncTerminalConfirmationStatus(ASYNC_TOOL_CONFIRMATION_STATUS.cancelled)).toBe(true)
    expect(isAsyncTerminalConfirmationStatus(ASYNC_TOOL_CONFIRMATION_STATUS.background)).toBe(true)
  })
})
