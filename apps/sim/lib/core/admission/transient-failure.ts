export const ADMISSION_RETRY_AFTER_SECONDS = 5

export const ADMISSION_ERROR_CODE = {
  GATE_CAPACITY: 'ADMISSION_GATE_CAPACITY',
  RESERVATION_CONCURRENCY: 'EXECUTION_CONCURRENCY_LIMIT',
  RESERVATION_PAYER_HEADROOM: 'EXECUTION_PAYER_HEADROOM_EXHAUSTED',
  RESERVATION_MEMBER_HEADROOM: 'EXECUTION_MEMBER_HEADROOM_EXHAUSTED',
  RESERVATION_INFRASTRUCTURE: 'SERVICE_OVERLOADED',
} as const

export interface AdmissionErrorDescriptor {
  readonly code: (typeof ADMISSION_ERROR_CODE)[keyof typeof ADMISSION_ERROR_CODE]
  readonly statusCode: number
  /** Whether unattended callers may automatically retry this failure. */
  readonly retryable: boolean
  readonly retryAfterSeconds?: number
}

export const ADMISSION_ERROR_DESCRIPTOR = {
  GATE_CAPACITY: {
    code: ADMISSION_ERROR_CODE.GATE_CAPACITY,
    statusCode: 429,
    retryable: true,
    retryAfterSeconds: ADMISSION_RETRY_AFTER_SECONDS,
  },
  RESERVATION_CONCURRENCY: {
    code: ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
    statusCode: 429,
    retryable: true,
    retryAfterSeconds: ADMISSION_RETRY_AFTER_SECONDS,
  },
  RESERVATION_PAYER_HEADROOM: {
    code: ADMISSION_ERROR_CODE.RESERVATION_PAYER_HEADROOM,
    statusCode: 402,
    retryable: false,
  },
  RESERVATION_MEMBER_HEADROOM: {
    code: ADMISSION_ERROR_CODE.RESERVATION_MEMBER_HEADROOM,
    statusCode: 402,
    retryable: false,
  },
  RESERVATION_INFRASTRUCTURE: {
    code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE,
    statusCode: 503,
    retryable: true,
    retryAfterSeconds: ADMISSION_RETRY_AFTER_SECONDS,
  },
} as const satisfies Record<keyof typeof ADMISSION_ERROR_CODE, AdmissionErrorDescriptor>

export type ReservationDenialReason = 'payer_concurrency' | 'payer_headroom' | 'member_headroom'

export const RESERVATION_DENIAL_DESCRIPTOR = {
  payer_concurrency: ADMISSION_ERROR_DESCRIPTOR.RESERVATION_CONCURRENCY,
  payer_headroom: ADMISSION_ERROR_DESCRIPTOR.RESERVATION_PAYER_HEADROOM,
  member_headroom: ADMISSION_ERROR_DESCRIPTOR.RESERVATION_MEMBER_HEADROOM,
} as const satisfies Record<ReservationDenialReason, AdmissionErrorDescriptor>

/**
 * Maps an atomic reservation denial to its transport-neutral admission policy.
 */
export function getReservationDenialDescriptor<Reason extends ReservationDenialReason>(
  reason: Reason
): (typeof RESERVATION_DENIAL_DESCRIPTOR)[Reason] {
  return RESERVATION_DENIAL_DESCRIPTOR[reason]
}

export interface AdmissionFailureLike {
  statusCode: number
  code?: unknown
  retryable?: boolean
  cause?: Record<string, unknown>
}

export type TransientAdmissionFailure =
  | ({
      kind: 'reservation_concurrency'
    } & typeof ADMISSION_ERROR_DESCRIPTOR.RESERVATION_CONCURRENCY)
  | ({
      kind: 'reservation_infrastructure'
    } & typeof ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE)

function hasAdmissionCode(failure: AdmissionFailureLike, code: string): boolean {
  return failure.code === code || failure.cause?.code === code
}

/**
 * Identifies only admission failures that unattended callers can safely retry.
 */
export function classifyTransientAdmissionFailure(
  failure: AdmissionFailureLike | null | undefined
): TransientAdmissionFailure | null {
  if (failure?.retryable !== true) return null

  const concurrency = ADMISSION_ERROR_DESCRIPTOR.RESERVATION_CONCURRENCY
  if (
    failure.statusCode === concurrency.statusCode &&
    hasAdmissionCode(failure, concurrency.code)
  ) {
    return {
      kind: 'reservation_concurrency',
      ...concurrency,
    }
  }

  const infrastructure = ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE
  if (
    failure.statusCode === infrastructure.statusCode &&
    hasAdmissionCode(failure, infrastructure.code)
  ) {
    return {
      kind: 'reservation_infrastructure',
      ...infrastructure,
    }
  }

  return null
}
