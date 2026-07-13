/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_AUTOMATIC_RESUME_ADMISSION_RETRIES,
  resolveAutomaticResumeAdmissionFailure,
} from '@/lib/workflows/executor/resume-policy'

describe('automatic resume admission policy', () => {
  const now = new Date('2026-07-10T12:00:00.000Z')

  it('schedules an explicitly retryable failure below the finite cap', () => {
    expect(
      resolveAutomaticResumeAdmissionFailure({
        currentRetryCount: 0,
        retryable: true,
        now,
      })
    ).toEqual({
      state: 'waiting',
      retryCount: 1,
      retryAt: new Date('2026-07-10T12:01:00.000Z'),
    })
  })

  it('schedules the final retry below the cap', () => {
    expect(
      resolveAutomaticResumeAdmissionFailure({
        currentRetryCount: MAX_AUTOMATIC_RESUME_ADMISSION_RETRIES - 1,
        retryable: true,
        now,
      })
    ).toEqual({
      state: 'waiting',
      retryCount: MAX_AUTOMATIC_RESUME_ADMISSION_RETRIES,
      retryAt: new Date('2026-07-10T12:01:00.000Z'),
    })
  })

  it('requires intervention when the retryable failure exhausts the cap', () => {
    expect(
      resolveAutomaticResumeAdmissionFailure({
        currentRetryCount: MAX_AUTOMATIC_RESUME_ADMISSION_RETRIES,
        retryable: true,
        now,
      })
    ).toEqual({
      state: 'intervention_required',
      retryCount: MAX_AUTOMATIC_RESUME_ADMISSION_RETRIES,
      retryAt: null,
    })
  })

  it('requires intervention immediately for permanent or unclassified failures', () => {
    expect(
      resolveAutomaticResumeAdmissionFailure({
        currentRetryCount: 1,
        retryable: false,
        now,
      })
    ).toEqual({
      state: 'intervention_required',
      retryCount: 1,
      retryAt: null,
    })
  })
})
