/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
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

import { getBillingDisabledTableLimits } from '@/lib/table/constants'

describe('getBillingDisabledTableLimits', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) delete mockEnv[key]
  })

  it('is unlimited when no free-tier env vars are set', () => {
    expect(getBillingDisabledTableLimits()).toEqual({
      maxTables: Number.MAX_SAFE_INTEGER,
      maxRowsPerTable: Number.MAX_SAFE_INTEGER,
    })
  })

  it('opts each cap back in independently when its env var is explicitly set', () => {
    mockEnv.FREE_TABLES_LIMIT = '7'

    expect(getBillingDisabledTableLimits()).toEqual({
      maxTables: 7,
      maxRowsPerTable: Number.MAX_SAFE_INTEGER,
    })

    mockEnv.FREE_TABLE_ROWS_LIMIT = '2500'
    expect(getBillingDisabledTableLimits()).toEqual({
      maxTables: 7,
      maxRowsPerTable: 2500,
    })
  })
})
