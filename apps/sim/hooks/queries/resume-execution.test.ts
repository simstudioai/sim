import { describe, expect, it } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import { shouldRetryResumeExecutionDetail } from '@/hooks/queries/resume-execution'

function apiError(status: number): ApiClientError {
  return new ApiClientError({
    status,
    message: 'Request failed',
    body: { error: 'Request failed' },
  })
}

describe('shouldRetryResumeExecutionDetail', () => {
  it.each([401, 403, 404])('does not retry terminal HTTP %s responses', (status) => {
    expect(shouldRetryResumeExecutionDetail(0, apiError(status))).toBe(false)
  })
})
