import { describe, expect, it } from 'vitest'
import {
  capResultRows,
  capStatementRows,
  MAX_TOOL_RESPONSE_BODY_BYTES,
  toRowsResponseBody,
} from '@/lib/internal/tool-operations/response-limits'

describe('database result caps', () => {
  it('keeps every row of a result inside both ceilings', () => {
    const rows = Array.from({ length: 10_000 }, (_, id) => ({ id }))
    expect(capResultRows(rows)).toEqual({ rows, truncated: false })
  })

  it('stops at the row ceiling', () => {
    const rows = Array.from({ length: 10_001 }, (_, id) => ({ id }))
    const capped = capResultRows(rows)
    expect(capped.truncated).toBe(true)
    expect(capped.rows).toHaveLength(10_000)
  })

  it('measures UTF-8 bytes, so multibyte text cannot exceed the response ceiling', () => {
    const value = '漢'.repeat(100_000)
    const capped = capStatementRows(
      Array.from({ length: 50 }, () => ({ value })),
      50,
      'Page the rest.'
    )
    expect(capped.truncated).toBe(true)
    const body = JSON.stringify(toRowsResponseBody(capped, 'Query done.'))
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_TOOL_RESPONSE_BODY_BYTES)
  })

  it('drops a single row larger than the ceiling instead of admitting it', () => {
    const capped = capResultRows([{ blob: 'x'.repeat(MAX_TOOL_RESPONSE_BODY_BYTES) }])
    expect(capped).toEqual({ rows: [], truncated: true })
  })
})
