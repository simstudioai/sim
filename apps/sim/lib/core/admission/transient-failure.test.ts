/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ADMISSION_ERROR_CODE,
  ADMISSION_ERROR_DESCRIPTOR,
  ADMISSION_RETRY_AFTER_SECONDS,
  classifyTransientAdmissionFailure,
  getReservationDenialDescriptor,
} from '@/lib/core/admission/transient-failure'

describe('classifyTransientAdmissionFailure', () => {
  it('classifies retryable reservation concurrency', () => {
    expect(
      classifyTransientAdmissionFailure({
        statusCode: 429,
        retryable: true,
        code: ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
      })
    ).toEqual({
      kind: 'reservation_concurrency',
      statusCode: 429,
      code: ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
      retryable: true,
      retryAfterSeconds: ADMISSION_RETRY_AFTER_SECONDS,
    })
  })

  it('classifies retryable reservation infrastructure failures', () => {
    expect(
      classifyTransientAdmissionFailure({
        statusCode: 503,
        retryable: true,
        cause: { code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE },
      })
    ).toEqual({
      kind: 'reservation_infrastructure',
      statusCode: 503,
      code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE,
      retryable: true,
      retryAfterSeconds: ADMISSION_RETRY_AFTER_SECONDS,
    })
  })

  it.each([
    {
      name: 'payer headroom',
      failure: { statusCode: 402, retryable: true, cause: { constraint: 'payer_headroom' } },
    },
    {
      name: 'member headroom',
      failure: { statusCode: 402, retryable: true, cause: { constraint: 'member_headroom' } },
    },
    {
      name: 'authorization',
      failure: { statusCode: 403, retryable: true },
    },
    {
      name: 'retryable non-admission rate limit',
      failure: { statusCode: 429, retryable: true, code: 'RATE_LIMIT_EXCEEDED' },
    },
    {
      name: 'unmarked retryable rate limit',
      failure: { statusCode: 429, retryable: true },
    },
    {
      name: 'unmarked service failure',
      failure: { statusCode: 503, retryable: true },
    },
  ])('does not classify $name failures', ({ failure }) => {
    expect(classifyTransientAdmissionFailure(failure)).toBeNull()
  })
})

describe('getReservationDenialDescriptor', () => {
  it.each([
    [
      'payer_concurrency',
      ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
      429,
      true,
      ADMISSION_RETRY_AFTER_SECONDS,
    ],
    ['payer_headroom', ADMISSION_ERROR_CODE.RESERVATION_PAYER_HEADROOM, 402, false, undefined],
    ['member_headroom', ADMISSION_ERROR_CODE.RESERVATION_MEMBER_HEADROOM, 402, false, undefined],
  ] as const)(
    'maps %s to stable admission metadata',
    (reason, code, statusCode, retryable, retryAfterSeconds) => {
      expect(getReservationDenialDescriptor(reason)).toEqual({
        code,
        statusCode,
        retryable,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      })
    }
  )

  it('returns the canonical descriptor object', () => {
    expect(getReservationDenialDescriptor('payer_concurrency')).toBe(
      ADMISSION_ERROR_DESCRIPTOR.RESERVATION_CONCURRENCY
    )
  })
})
