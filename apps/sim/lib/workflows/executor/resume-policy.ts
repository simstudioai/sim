import { truncate } from '@sim/utils/string'

export const RESUME_ADMISSION_RETRY_DELAY_MS = 60_000
export const AUTOMATIC_RESUME_WAITING_REASON_MAX_LENGTH = 500
export const MAX_AUTOMATIC_RESUME_ADMISSION_RETRIES = 3

const TRUNCATION_SUFFIX = '...'
const DEFAULT_WAITING_REASON = 'Resume admission is temporarily unavailable'

export interface AutomaticResumeWaitingMetadata {
  contextId: string
  reason: string
  recordedAt: string
  state: 'waiting' | 'intervention_required'
  retryCount: number
}

export type AutomaticResumeAdmissionFailureDecision =
  | {
      state: 'waiting'
      retryCount: number
      retryAt: Date
    }
  | {
      state: 'intervention_required'
      retryCount: number
      retryAt: null
    }

export function getResumeAdmissionRetryAt(now: Date): Date {
  return new Date(now.getTime() + RESUME_ADMISSION_RETRY_DELAY_MS)
}

export function resolveAutomaticResumeAdmissionFailure(args: {
  currentRetryCount: number
  retryable: boolean
  now: Date
  retryAt?: Date
}): AutomaticResumeAdmissionFailureDecision {
  const currentRetryCount = Math.max(0, Math.floor(args.currentRetryCount))
  if (!args.retryable) {
    return {
      state: 'intervention_required',
      retryCount: currentRetryCount,
      retryAt: null,
    }
  }

  if (currentRetryCount >= MAX_AUTOMATIC_RESUME_ADMISSION_RETRIES) {
    return {
      state: 'intervention_required',
      retryCount: MAX_AUTOMATIC_RESUME_ADMISSION_RETRIES,
      retryAt: null,
    }
  }

  return {
    state: 'waiting',
    retryCount: currentRetryCount + 1,
    retryAt: args.retryAt ?? getResumeAdmissionRetryAt(args.now),
  }
}

export function normalizeAutomaticResumeWaitingReason(reason: string): string {
  const normalized = reason.trim() || DEFAULT_WAITING_REASON
  return truncate(
    normalized,
    AUTOMATIC_RESUME_WAITING_REASON_MAX_LENGTH - TRUNCATION_SUFFIX.length,
    TRUNCATION_SUFFIX
  )
}
