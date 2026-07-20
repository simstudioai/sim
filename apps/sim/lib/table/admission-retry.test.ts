/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMISSION_ERROR_CODE } from '@/lib/core/admission/transient-failure'
import type { PreprocessExecutionResult } from '@/lib/execution/preprocessing'

const { mockBackoffWithJitter, mockSleep } = vi.hoisted(() => ({
  mockBackoffWithJitter: vi.fn(),
  mockSleep: vi.fn(),
}))

vi.mock('@sim/utils/helpers', () => ({
  sleep: mockSleep,
}))

vi.mock('@sim/utils/retry', () => ({
  backoffWithJitter: mockBackoffWithJitter,
}))

import {
  retryTableAdmission,
  TABLE_ADMISSION_RETRY_MAX_ATTEMPTS,
} from '@/lib/table/admission-retry'

describe('retryTableAdmission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBackoffWithJitter.mockReturnValue(25)
    mockSleep.mockResolvedValue(undefined)
  })

  it('bounds transient retries and returns the exact exhausted error', async () => {
    const exhaustedResult = {
      success: false,
      error: {
        message: 'Usage admission is temporarily unavailable. Please retry.',
        statusCode: 503,
        code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE,
        retryable: true,
        cause: { code: 'SERVICE_OVERLOADED' },
      },
    } satisfies PreprocessExecutionResult
    const operation = vi.fn().mockResolvedValue(exhaustedResult)

    const result = await retryTableAdmission(operation)

    expect(result).toBe(exhaustedResult)
    if (result.success) throw new Error('Expected exhausted admission retries to fail')
    expect(result.error.message).toBe('Usage admission is temporarily unavailable. Please retry.')
    expect(operation).toHaveBeenCalledTimes(TABLE_ADMISSION_RETRY_MAX_ATTEMPTS)
    expect(mockSleep).toHaveBeenCalledTimes(TABLE_ADMISSION_RETRY_MAX_ATTEMPTS - 1)
  })

  it.each([
    {
      statusCode: 402,
      message: 'Payer headroom exhausted',
      retryable: false,
      code: ADMISSION_ERROR_CODE.RESERVATION_PAYER_HEADROOM,
    },
    { statusCode: 403, message: 'Account suspended', retryable: true },
    {
      statusCode: 429,
      message: 'Rate limit exceeded',
      retryable: true,
      code: 'RATE_LIMIT_EXCEEDED',
    },
  ])('does not retry a $statusCode failure', async ({ statusCode, message, retryable, code }) => {
    const terminalResult = {
      success: false,
      error: {
        message,
        statusCode,
        retryable,
        ...(code ? { code } : {}),
      },
    } satisfies PreprocessExecutionResult
    const operation = vi.fn().mockResolvedValue(terminalResult)

    await expect(retryTableAdmission(operation)).resolves.toBe(terminalResult)

    expect(operation).toHaveBeenCalledOnce()
    expect(mockSleep).not.toHaveBeenCalled()
  })
})
