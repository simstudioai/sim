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

/**
 * Query-suffixed import gives this file a private instance of the module under
 * test. Under `isolate: false` the worker's module graph is shared across test
 * files, so the plain specifier may already be cached with the real env binding
 * (mocks never reach an already-evaluated module) — and evaluating it here
 * under this file's mocks would poison it for later files. The suffixed id is
 * unique to this file, so it always evaluates fresh with the mock above.
 */
declare module '@/lib/table/constants?constants-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient type re-declaration for the query-suffixed specifier, not a runtime export
  export * from '@/lib/table/constants'
}

import { getBillingDisabledTableLimits } from '@/lib/table/constants?constants-test'

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
