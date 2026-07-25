/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { adminV1GlobalWorkQuerySchema } from '@/lib/api/contracts/v1/admin/global-work'

describe('Global Work admin query contract', () => {
  it('accepts either a user or organization filter', () => {
    expect(
      adminV1GlobalWorkQuerySchema.safeParse({ month: '2026-06', userId: 'user-1' }).success
    ).toBe(true)
    expect(
      adminV1GlobalWorkQuerySchema.safeParse({
        month: '2026-06',
        organizationId: 'org-1',
      }).success
    ).toBe(true)
  })

  it('rejects ambiguous combined filters', () => {
    expect(
      adminV1GlobalWorkQuerySchema.safeParse({
        month: '2026-06',
        userId: 'user-1',
        organizationId: 'org-1',
      }).success
    ).toBe(false)
  })
})
