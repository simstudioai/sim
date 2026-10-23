import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  getBillingDisabledTableLimits,
  getDeleteSnapshotBatchSize,
  getMaxRowSizeBytes,
  TABLE_LIMITS,
} from '@/lib/table/constants'

const UNSET_TABLE_ENV = {
  FREE_TABLES_LIMIT: undefined,
  FREE_TABLE_ROWS_LIMIT: undefined,
  TABLE_MAX_ROW_SIZE_BYTES: undefined,
}

afterAll(resetEnvMock)

describe('getBillingDisabledTableLimits', () => {
  beforeEach(() => {
    setEnv(UNSET_TABLE_ENV)
  })

  it('opts each cap back in independently when its env var is explicitly set', () => {
    setEnv({ FREE_TABLES_LIMIT: '7' })

    expect(getBillingDisabledTableLimits()).toEqual({
      maxTables: 7,
      maxRowsPerTable: Number.MAX_SAFE_INTEGER,
    })

    setEnv({ FREE_TABLE_ROWS_LIMIT: '2500' })
    expect(getBillingDisabledTableLimits()).toEqual({
      maxTables: 7,
      maxRowsPerTable: 2500,
    })
  })
})

describe('getMaxRowSizeBytes', () => {
  beforeEach(() => {
    setEnv(UNSET_TABLE_ENV)
  })

  it('caps overrides at the delete snapshot byte budget', () => {
    setEnv({ TABLE_MAX_ROW_SIZE_BYTES: String(TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES * 2) })

    expect(getMaxRowSizeBytes()).toBe(TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES)
  })
})

describe('getDeleteSnapshotBatchSize', () => {
  beforeEach(() => {
    setEnv(UNSET_TABLE_ENV)
  })

  it('derives a worst-case row cap from the delete snapshot byte budget', () => {
    expect(getDeleteSnapshotBatchSize()).toBe(
      Math.floor(TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES / TABLE_LIMITS.MAX_ROW_SIZE_BYTES)
    )
  })

  it('always processes one row and never exceeds the delete row-count cap', () => {
    setEnv({ TABLE_MAX_ROW_SIZE_BYTES: String(TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES * 2) })
    expect(getDeleteSnapshotBatchSize()).toBe(1)

    setEnv({ TABLE_MAX_ROW_SIZE_BYTES: '1' })
    expect(getDeleteSnapshotBatchSize()).toBe(TABLE_LIMITS.DELETE_BATCH_SIZE)
  })
})
