import { describe, expect, it } from 'vitest'
import { PolymarketBlock } from '@/blocks/blocks/polymarket'
import { polymarketGetActivityTool } from '@/tools/polymarket/get_activity'

/** The Get Activity request URL the canvas sends for the stored block values. */
function activityUrl(stored: Record<string, unknown>): URL {
  const inputs = { operation: 'get_activity', activityUser: '0xabc', ...stored }
  const mapped = PolymarketBlock.tools.config?.params?.(inputs) ?? {}
  const url = polymarketGetActivityTool.request.url
  if (typeof url !== 'function') throw new Error('Missing activity URL builder')
  return new URL(url({ user: '0xabc', ...mapped }))
}

describe('Polymarket Get Activity start and end', () => {
  it('reads a numeric 0 start from a reference as the full history', () => {
    expect(activityUrl({ activityStart: 0 }).searchParams.get('start')).toBe('1')
  })

  it("rejects a start that is not a timestamp with the tool's own message", () => {
    expect(() => activityUrl({ activityStart: 'yesterday' })).toThrow(
      'start must be a Unix timestamp in seconds, got "yesterday".'
    )
  })

  it('leaves an untouched start and end unset', () => {
    const url = activityUrl({ activityStart: null, activityEnd: '' })
    expect(url.searchParams.has('start')).toBe(false)
    expect(url.searchParams.has('end')).toBe(false)
  })
})
