/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ENROW_CREDIT_USD } from '@/tools/enrow/hosting'

describe('enrow hosted-key pricing', () => {
  it('prices a credit at the entry Start tier ($17 / 1,000 credits)', () => {
    expect(ENROW_CREDIT_USD).toBeCloseTo(17 / 1000, 6)
  })

  it('never bills below the entry tier rate', () => {
    expect(ENROW_CREDIT_USD).toBeGreaterThanOrEqual(0.017)
  })
})
