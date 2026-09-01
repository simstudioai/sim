/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENTERPRISE_WORKFLOW_EXECUTION_TIMEOUT_SECONDS,
  MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS,
  resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds,
} from '@/lib/billing/execution-timeout-defaults'

describe('resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds', () => {
  it('accepts a bounded positive integer', () => {
    expect(resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds('86400')).toBe(86_400)
  })

  it.each([undefined, '', '0', '-1', '1.5', 'not-a-number'])(
    'uses the product default for invalid value %s',
    (value) => {
      expect(resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds(value)).toBe(
        DEFAULT_ENTERPRISE_WORKFLOW_EXECUTION_TIMEOUT_SECONDS
      )
    }
  )

  it('uses the product default above the hosted seven-day ceiling', () => {
    expect(
      resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds(
        MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS + 1
      )
    ).toBe(DEFAULT_ENTERPRISE_WORKFLOW_EXECUTION_TIMEOUT_SECONDS)
  })
})
