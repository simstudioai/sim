/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getCopilotDeploymentIdempotencyKey,
  getHistoricalDeploymentAttemptError,
} from '@/lib/copilot/tools/handlers/deployment/context'

describe('getCopilotDeploymentIdempotencyKey', () => {
  it('is stable for a replay of the same logical tool call', () => {
    const context = { executionId: 'execution-1', runId: 'run-1', toolCallId: 'call-1' }

    expect(getCopilotDeploymentIdempotencyKey(context)).toBe(
      getCopilotDeploymentIdempotencyKey(context)
    )
  })

  it('separates different tool calls within the same Mothership execution', () => {
    expect(
      getCopilotDeploymentIdempotencyKey({ executionId: 'execution-1', toolCallId: 'call-1' })
    ).not.toBe(
      getCopilotDeploymentIdempotencyKey({ executionId: 'execution-1', toolCallId: 'call-2' })
    )
  })

  it('does not derive a turn-wide key when the tool-call identity is unavailable', () => {
    expect(getCopilotDeploymentIdempotencyKey({ executionId: 'execution-1' })).toBeUndefined()
  })
})

describe('getHistoricalDeploymentAttemptError', () => {
  it('requires a new tool call when the persisted attempt is no longer current', () => {
    expect(getHistoricalDeploymentAttemptError({ isCurrent: false }, 'redeploy')).toContain(
      'Start a new tool call'
    )
    expect(getHistoricalDeploymentAttemptError({ isCurrent: true }, 'redeploy')).toBeNull()
  })
})
