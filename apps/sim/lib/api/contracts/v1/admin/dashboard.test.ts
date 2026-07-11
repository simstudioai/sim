/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { adminDashboardCreditsBodySchema } from '@/lib/api/contracts/v1/admin/dashboard'

describe('admin dashboard credit grant contract', () => {
  it('requires a client-stable UUID operation ID', () => {
    expect(
      adminDashboardCreditsBodySchema.safeParse({
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        credits: 10_000,
      }).success
    ).toBe(true)
    expect(adminDashboardCreditsBodySchema.safeParse({ credits: 10_000 }).success).toBe(false)
    expect(
      adminDashboardCreditsBodySchema.safeParse({ operationId: 'retry-1', credits: 10_000 }).success
    ).toBe(false)
  })
})
