import { describe, expect, it } from 'vitest'
import {
  describeRetryableInfrastructureError,
  isRetryableInfrastructureError,
} from '@/lib/core/errors/retryable-infrastructure'
import { buildWorkflowCorrelation } from '@/background/workflow-execution'

describe('async execution correlation fallbacks', () => {
  it('falls back for legacy workflow payloads missing correlation fields', () => {
    const correlation = buildWorkflowCorrelation({
      workflowId: 'workflow-1',
      userId: 'user-1',
      triggerType: 'api',
      executionId: 'execution-legacy',
    })

    expect(correlation).toEqual({
      executionId: 'execution-legacy',
      requestId: 'executio',
      source: 'workflow',
      workflowId: 'workflow-1',
      triggerType: 'api',
    })
  })

  it('preserves a trusted Copilot workflow tool binding', () => {
    const correlation = buildWorkflowCorrelation({
      workflowId: 'workflow-1',
      userId: 'user-1',
      triggerType: 'copilot',
      executionId: 'execution-copilot',
      correlation: {
        executionId: 'execution-copilot',
        requestId: 'request-copilot',
        source: 'workflow',
        workflowId: 'workflow-1',
        triggerType: 'copilot',
        copilotToolCallId: 'tool-call-1',
      },
    })

    expect(correlation).toEqual({
      executionId: 'execution-copilot',
      requestId: 'request-copilot',
      source: 'workflow',
      workflowId: 'workflow-1',
      triggerType: 'copilot',
      copilotToolCallId: 'tool-call-1',
    })
  })

  it('classifies retryable driver causes without treating every failed query as retryable', () => {
    const driverError = Object.assign(new Error('remaining connection slots are reserved'), {
      code: '53300',
    })
    const drizzleError = new Error('Failed query: select * from "environment"', {
      cause: driverError,
    })

    expect(isRetryableInfrastructureError(drizzleError)).toBe(true)
    expect(describeRetryableInfrastructureError(drizzleError)).toEqual(
      expect.objectContaining({
        code: '53300',
        message: 'remaining connection slots are reserved',
      })
    )
    expect(
      isRetryableInfrastructureError(new Error('remaining connection slots are reserved'))
    ).toBe(false)
    expect(
      isRetryableInfrastructureError(
        Object.assign(new Error('connect failed'), { code: 'ETIMEDOUT' })
      )
    ).toBe(true)
    expect(isRetryableInfrastructureError(new Error('Failed query: syntax error'))).toBe(false)
  })
})
