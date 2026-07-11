import { truncate } from '@sim/utils/string'

export const RESUME_ADMISSION_RETRY_DELAY_MS = 60_000
export const AUTOMATIC_RESUME_WAITING_REASON_MAX_LENGTH = 500

const TRUNCATION_SUFFIX = '...'
const DEFAULT_WAITING_REASON = 'Resume admission is temporarily unavailable'

export interface AutomaticResumeWaitingMetadata {
  contextId: string
  reason: string
  recordedAt: string
}

export function getResumeAdmissionRetryAt(now: Date): Date {
  return new Date(now.getTime() + RESUME_ADMISSION_RETRY_DELAY_MS)
}

export function normalizeAutomaticResumeWaitingReason(reason: string): string {
  const normalized = reason.trim() || DEFAULT_WAITING_REASON
  return truncate(
    normalized,
    AUTOMATIC_RESUME_WAITING_REASON_MAX_LENGTH - TRUNCATION_SUFFIX.length,
    TRUNCATION_SUFFIX
  )
}
