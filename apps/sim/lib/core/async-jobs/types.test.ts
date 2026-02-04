/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { JOB_MAX_LIFETIME_SECONDS, JOB_RETENTION_HOURS, JOB_RETENTION_SECONDS } from './types'

describe('Job retention constants', () => {
  it.concurrent('JOB_RETENTION_HOURS should be 24', async () => {
    expect(JOB_RETENTION_HOURS).toBe(24)
  })

  it.concurrent('JOB_RETENTION_SECONDS should be derived from JOB_RETENTION_HOURS', async () => {
    expect(JOB_RETENTION_SECONDS).toBe(JOB_RETENTION_HOURS * 60 * 60)
  })

  it.concurrent('JOB_RETENTION_SECONDS should equal 86400 (24 hours)', async () => {
    expect(JOB_RETENTION_SECONDS).toBe(86400)
  })

  it.concurrent('constants should be consistent with each other', async () => {
    const hoursToSeconds = JOB_RETENTION_HOURS * 60 * 60
    expect(JOB_RETENTION_SECONDS).toBe(hoursToSeconds)
  })

  it.concurrent(
    'JOB_MAX_LIFETIME_SECONDS should be greater than JOB_RETENTION_SECONDS',
    async () => {
      expect(JOB_MAX_LIFETIME_SECONDS).toBeGreaterThan(JOB_RETENTION_SECONDS)
      expect(JOB_MAX_LIFETIME_SECONDS).toBe(48 * 60 * 60)
    }
  )
})
