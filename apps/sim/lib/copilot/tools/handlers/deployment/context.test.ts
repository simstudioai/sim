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

    expect(getCopilotDeploymentIdempotencyKey(context, 'redeploy')).toBe(
      getCopilotDeploymentIdempotencyKey(context, 'redeploy')
    )
  })

  it('reuses one operation scope across model retries with new tool-call ids', () => {
    expect(
      getCopilotDeploymentIdempotencyKey(
        { executionId: 'execution-1', toolCallId: 'call-1' },
        'redeploy'
      )
    ).toBe(
      getCopilotDeploymentIdempotencyKey(
        { executionId: 'execution-1', toolCallId: 'call-2' },
        'redeploy'
      )
    )
  })

  it('separates deployment intents within the same execution', () => {
    const context = { executionId: 'execution-1', toolCallId: 'call-1' }

    expect(getCopilotDeploymentIdempotencyKey(context, 'deploy_as_api')).not.toBe(
      getCopilotDeploymentIdempotencyKey(context, 'redeploy')
    )
  })

  it('does not derive a turn-wide key when the tool-call identity is unavailable', () => {
    expect(getCopilotDeploymentIdempotencyKey({}, 'redeploy')).toBeUndefined()
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
