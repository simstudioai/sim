/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockFlags } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  mockFlags: { isBillingEnabled: true },
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  envNumber: (
    value: number | string | undefined | null,
    fallback: number,
    options: { min?: number; integer?: boolean } = {}
  ) => {
    const parsed = Number(value)
    const min = options.min ?? 0
    return Number.isFinite(parsed) &&
      parsed >= min &&
      (!options.integer || Number.isInteger(parsed))
      ? parsed
      : fallback
  },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
}))

import {
  getMaxTableDispatchConcurrency,
  getTableDispatchConcurrency,
} from '@/lib/table/dispatch-concurrency'

describe('getTableDispatchConcurrency', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) delete mockEnv[key]
    mockFlags.isBillingEnabled = true
  })

  it('resolves free vs paid defaults', () => {
    expect(getTableDispatchConcurrency(null)).toBe(20)
    expect(getTableDispatchConcurrency('free')).toBe(20)
    expect(getTableDispatchConcurrency('pro_6000')).toBe(50)
    expect(getTableDispatchConcurrency('team_25000')).toBe(50)
    expect(getTableDispatchConcurrency('enterprise')).toBe(50)
  })

  it('applies env overrides', () => {
    mockEnv.TABLE_DISPATCH_CONCURRENCY_FREE = '5'
    mockEnv.TABLE_DISPATCH_CONCURRENCY_PAID = '200'

    expect(getTableDispatchConcurrency('free')).toBe(5)
    expect(getTableDispatchConcurrency('pro_6000')).toBe(200)
    expect(getTableDispatchConcurrency('enterprise')).toBe(200)
  })

  it('uses the paid value when billing is disabled', () => {
    mockFlags.isBillingEnabled = false
    expect(getTableDispatchConcurrency(null)).toBe(50)

    mockEnv.TABLE_DISPATCH_CONCURRENCY_PAID = '120'
    expect(getTableDispatchConcurrency(null)).toBe(120)
  })
})

describe('getMaxTableDispatchConcurrency', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) delete mockEnv[key]
  })

  it('returns the highest configured value', () => {
    expect(getMaxTableDispatchConcurrency()).toBe(50)

    mockEnv.TABLE_DISPATCH_CONCURRENCY_FREE = '80'
    expect(getMaxTableDispatchConcurrency()).toBe(80)
  })
})
