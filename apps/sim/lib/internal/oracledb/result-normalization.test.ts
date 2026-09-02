/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  capOracleResult,
  ORACLE_MAX_RESULT_BYTES,
  ORACLE_MAX_RESULT_ROWS,
  toOracleRowsResponseBody,
} from '@/lib/internal/oracledb/result-normalization'

describe('Oracle result response limits', () => {
  it('caps exact row cardinality and discloses truncation', () => {
    const rows = Array.from({ length: ORACLE_MAX_RESULT_ROWS + 1 }, (_, value) => ({ value }))
    const result = capOracleResult({ rows, rowCount: rows.length })

    expect(result.rows).toHaveLength(ORACLE_MAX_RESULT_ROWS)
    expect(result.truncated).toBe(true)
    expect(result.truncationReason).toContain('10,000 rows')
  })

  it('drops a first row that alone exceeds the UTF-8 byte ceiling', () => {
    const result = capOracleResult({
      rows: [{ value: '界'.repeat(ORACLE_MAX_RESULT_BYTES) }],
      rowCount: 1,
    })

    expect(result.rows).toEqual([])
    expect(result.rowCount).toBe(0)
    expect(result.truncationReason).toContain('first row alone exceeds')
  })

  it('preserves DML affected-row counts and worker truncation metadata', () => {
    expect(capOracleResult({ rows: [], rowCount: 12 })).toEqual({ rows: [], rowCount: 12 })
    expect(
      toOracleRowsResponseBody(
        { rows: [{ id: '1' }], rowCount: 1, truncated: true, truncationReason: 'limited' },
        'Query succeeded.'
      )
    ).toEqual({
      message: 'Query succeeded. limited',
      rows: [{ id: '1' }],
      rowCount: 1,
      truncated: true,
      truncationReason: 'limited',
    })
  })
})
