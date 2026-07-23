/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, resetEnvMock, setEnv, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  getMaxTableDispatchConcurrency,
  getTableDispatchConcurrency,
} from '@/lib/table/dispatch-concurrency'

afterAll(() => {
  resetEnvFlagsMock()
  resetEnvMock()
})

describe('getTableDispatchConcurrency', () => {
  beforeEach(() => {
    setEnv({
      TABLE_DISPATCH_CONCURRENCY_FREE: undefined,
      TABLE_DISPATCH_CONCURRENCY_PAID: undefined,
    })
    setEnvFlags({ isBillingEnabled: true })
  })

  it('resolves free vs paid defaults', () => {
    expect(getTableDispatchConcurrency(null)).toBe(20)
    expect(getTableDispatchConcurrency('free')).toBe(20)
    expect(getTableDispatchConcurrency('pro_6000')).toBe(50)
    expect(getTableDispatchConcurrency('team_25000')).toBe(50)
    expect(getTableDispatchConcurrency('enterprise')).toBe(50)
  })

  it('applies env overrides', () => {
    setEnv({ TABLE_DISPATCH_CONCURRENCY_FREE: '5' })
    setEnv({ TABLE_DISPATCH_CONCURRENCY_PAID: '200' })

    expect(getTableDispatchConcurrency('free')).toBe(5)
    expect(getTableDispatchConcurrency('pro_6000')).toBe(200)
    expect(getTableDispatchConcurrency('enterprise')).toBe(200)
  })

  it('uses the paid value when billing is disabled', () => {
    setEnvFlags({ isBillingEnabled: false })
    expect(getTableDispatchConcurrency(null)).toBe(50)

    setEnv({ TABLE_DISPATCH_CONCURRENCY_PAID: '120' })
    expect(getTableDispatchConcurrency(null)).toBe(120)
  })
})

describe('getMaxTableDispatchConcurrency', () => {
  beforeEach(() => {
    setEnv({
      TABLE_DISPATCH_CONCURRENCY_FREE: undefined,
      TABLE_DISPATCH_CONCURRENCY_PAID: undefined,
    })
  })

  it('returns the highest configured value', () => {
    expect(getMaxTableDispatchConcurrency()).toBe(50)

    setEnv({ TABLE_DISPATCH_CONCURRENCY_FREE: '80' })
    expect(getMaxTableDispatchConcurrency()).toBe(80)
  })
})
