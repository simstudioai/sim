/**
 * @vitest-environment node
 */

import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { getColumnRetypeScanBatchSize } from '@/lib/table/columns/service'
import { TABLE_LIMITS } from '@/lib/table/constants'

const RETYPE_SCAN_BUDGET_BYTES = 32 * 1024 * 1024

describe('column retype memory bounds', () => {
  afterEach(resetEnvMock)

  it('derives the page cap from the maximum row size and the fixed byte budget', () => {
    expect(getColumnRetypeScanBatchSize()).toBe(
      Math.floor(RETYPE_SCAN_BUDGET_BYTES / TABLE_LIMITS.MAX_ROW_SIZE_BYTES)
    )

    setEnv({ TABLE_MAX_ROW_SIZE_BYTES: 16 * 1024 * 1024 })
    expect(getColumnRetypeScanBatchSize()).toBe(2)
  })

  it('always processes at least one row without exceeding the row-count cap', () => {
    setEnv({ TABLE_MAX_ROW_SIZE_BYTES: RETYPE_SCAN_BUDGET_BYTES * 2 })
    expect(getColumnRetypeScanBatchSize()).toBe(1)

    setEnv({ TABLE_MAX_ROW_SIZE_BYTES: 1 })
    expect(getColumnRetypeScanBatchSize()).toBe(1000)
  })
})
