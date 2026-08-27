/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  V2_ERROR_CODE_BY_STATUS,
  V2_ERROR_STATUS_BY_CODE,
  type V2ErrorCode,
} from '@/lib/api/contracts/v2/error-codes'

describe('v2 error codes', () => {
  /**
   * The property the OpenAPI layer depends on: a documented error response derives its
   * `error.code` from the status it is declared under, so two codes sharing a status would
   * make one of those examples name a code that status never carries.
   */
  it('maps each code onto a status no other code claims', () => {
    const claimedBy = new Map<number, V2ErrorCode>()
    for (const [code, status] of Object.entries(V2_ERROR_STATUS_BY_CODE) as [
      V2ErrorCode,
      number,
    ][]) {
      expect(claimedBy.get(status), `${status} is claimed by more than one code`).toBeUndefined()
      claimedBy.set(status, code)
    }
    expect(claimedBy.size).toBe(Object.keys(V2_ERROR_STATUS_BY_CODE).length)
  })

  it('inverts without losing an entry', () => {
    for (const [code, status] of Object.entries(V2_ERROR_STATUS_BY_CODE) as [
      V2ErrorCode,
      number,
    ][]) {
      expect(V2_ERROR_CODE_BY_STATUS[status]).toBe(code)
    }
  })

  it('uses statuses in the HTTP error range', () => {
    for (const status of Object.values(V2_ERROR_STATUS_BY_CODE)) {
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(600)
    }
  })
})
