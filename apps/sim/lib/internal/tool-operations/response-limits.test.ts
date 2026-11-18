import { describe, expect, it } from 'vitest'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  createResponseRowsBudget,
  MAX_TOOL_RESPONSE_BODY_BYTES,
} from '@/lib/internal/tool-operations/response-limits'

/** Admits every row, returning the error the budget threw, if any. */
function admitAll(rows: unknown[]): unknown {
  const budget = createResponseRowsBudget('test_tool')
  try {
    for (const row of rows) budget.admit(row)
    return undefined
  } catch (error) {
    return error
  }
}

describe('response rows budget', () => {
  it('admits any number of rows while their array still fits the response limit', () => {
    expect(admitAll(Array.from({ length: 50_000 }, (_, id) => ({ id })))).toBeUndefined()
  })

  it('fails exactly where the serialized array passes the response limit', () => {
    const fitting = ['x'.repeat(MAX_TOOL_RESPONSE_BODY_BYTES - 4)]
    expect(Buffer.byteLength(JSON.stringify(fitting))).toBe(MAX_TOOL_RESPONSE_BODY_BYTES)
    expect(admitAll(fitting)).toBeUndefined()

    const error = admitAll(['x'.repeat(MAX_TOOL_RESPONSE_BODY_BYTES - 3)])
    expect(isPayloadSizeLimitError(error)).toBe(true)
    expect(error).toMatchObject({
      label: 'test_tool response body',
      maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
    })
  })

  it('counts UTF-8 bytes, so multibyte text fails on its encoded size', () => {
    const row = '漢'.repeat(MAX_TOOL_RESPONSE_BODY_BYTES / 3)
    expect(row.length).toBeLessThan(MAX_TOOL_RESPONSE_BODY_BYTES)
    expect(isPayloadSizeLimitError(admitAll([row]))).toBe(true)
  })
})
