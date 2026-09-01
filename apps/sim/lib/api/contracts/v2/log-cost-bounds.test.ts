import { describe, expect, it } from 'vitest'
import { v2ListLogsQuerySchema } from '@/lib/api/contracts/v2/logs'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

function parseQuery(query: Record<string, string>) {
  return v2ListLogsQuerySchema.safeParse({ workspaceId: WORKSPACE_ID, ...query })
}

/**
 * The cost window is the one filter pair on this read that answered a caller
 * mistake with an empty page: `minCost` above `maxCost` selects no run, and a
 * negative bound selects every run, so both reported a result rather than the
 * error the date window already reports for the same shape of mistake.
 */
describe('v2 logs cost bounds', () => {
  it('accepts fractional costs inside the published range', () => {
    const parsed = parseQuery({ minCost: '0.0001', maxCost: '12.5' })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.minCost).toBe(0.0001)
    expect(parsed.success && parsed.data.maxCost).toBe(12.5)
  })

  it.each([
    ['minCost', '-1'],
    ['maxCost', '-1'],
    ['minCost', '-1e308'],
  ])('rejects a negative %s (%s)', (field, value) => {
    const parsed = parseQuery({ [field]: value })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(`${field} must not be negative`)
    expect(parsed.error?.issues[0]?.path).toEqual([field])
  })

  it.each([
    ['minCost', '1000001'],
    ['maxCost', '1e30'],
  ])('rejects an out-of-range %s (%s)', (field, value) => {
    const parsed = parseQuery({ [field]: value })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(`${field} must be at most 1000000`)
  })

  it('rejects an inverted cost window rather than answering it with no runs', () => {
    const parsed = parseQuery({ minCost: '100', maxCost: '1' })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe('minCost must be less than or equal to maxCost')
    expect(parsed.error?.issues[0]?.path).toEqual(['minCost'])
  })

  it('accepts an equal cost window', () => {
    expect(parseQuery({ minCost: '1', maxCost: '1' }).success).toBe(true)
  })

  it('leaves a one-sided cost window alone', () => {
    expect(parseQuery({ minCost: '100' }).success).toBe(true)
    expect(parseQuery({ maxCost: '1' }).success).toBe(true)
  })

  /**
   * The duration window carries its own bounds but shared the cost window's
   * missing inversion check, so an inverted pair reported "those runs do not
   * exist" for what is a caller mistake.
   */
  it('rejects an inverted duration window rather than answering it with no runs', () => {
    const parsed = parseQuery({ minDurationMs: '100', maxDurationMs: '1' })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(
      'minDurationMs must be less than or equal to maxDurationMs'
    )
    expect(parsed.error?.issues[0]?.path).toEqual(['minDurationMs'])
  })

  it('accepts an equal duration window and leaves a one-sided one alone', () => {
    expect(parseQuery({ minDurationMs: '5', maxDurationMs: '5' }).success).toBe(true)
    expect(parseQuery({ minDurationMs: '100' }).success).toBe(true)
    expect(parseQuery({ maxDurationMs: '1' }).success).toBe(true)
  })

  it('reports both inverted windows when a caller sends both', () => {
    const parsed = parseQuery({
      minCost: '100',
      maxCost: '1',
      minDurationMs: '100',
      maxDurationMs: '1',
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual(['minCost', 'minDurationMs'])
  })
})
