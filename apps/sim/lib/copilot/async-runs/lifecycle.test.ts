/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  ASYNC_TOOL_STATUS,
  inferDeliveredAsyncSuccess,
  isDeliveredAsyncStatus,
  isTerminalAsyncStatus,
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

  it('treats delivered rows as success unless durable error/cancel markers say otherwise', () => {
    expect(isDeliveredAsyncStatus(ASYNC_TOOL_STATUS.delivered)).toBe(true)
    expect(inferDeliveredAsyncSuccess({ result: { ok: true }, error: null })).toBe(true)
    expect(inferDeliveredAsyncSuccess({ result: { cancelled: true }, error: null })).toBe(false)
    expect(inferDeliveredAsyncSuccess({ result: null, error: 'tool failed' })).toBe(false)
  })
})
