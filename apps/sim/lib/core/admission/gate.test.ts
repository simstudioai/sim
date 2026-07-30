/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { admissionRejectedResponse } from '@/lib/core/admission/gate'
import {
  ADMISSION_ERROR_DESCRIPTOR,
  ADMISSION_RETRY_AFTER_SECONDS,
} from '@/lib/core/admission/transient-failure'

describe('admissionRejectedResponse', () => {
  it('formats the canonical admission-gate rejection', async () => {
    const response = admissionRejectedResponse()
    const descriptor = ADMISSION_ERROR_DESCRIPTOR.GATE_CAPACITY

    expect(response.status).toBe(descriptor.statusCode)
    expect(response.headers.get('Retry-After')).toBe(String(ADMISSION_RETRY_AFTER_SECONDS))
    await expect(response.json()).resolves.toEqual({
      error: 'Too many requests',
      message: 'Server is at capacity. Please retry shortly.',
      code: descriptor.code,
      retryable: descriptor.retryable,
      retryAfterSeconds: descriptor.retryAfterSeconds,
    })
  })
})
