import { describe, expect, it } from 'vitest'
import { kalshiGetSettlementsV2Tool } from '@/tools/kalshi/get_settlements'

describe('Kalshi Get Settlements', () => {
  it('omits an untouched (null) or empty timestamp instead of failing', () => {
    const { url } = kalshiGetSettlementsV2Tool.request
    const build = (params: Record<string, unknown>) =>
      new URL(typeof url === 'function' ? url(params as never) : url)
    const empty = build({ minTs: null, maxTs: '' })
    expect(empty.searchParams.has('min_ts')).toBe(false)
    expect(empty.searchParams.has('max_ts')).toBe(false)
    expect(build({ minTs: 1700000000 }).searchParams.get('min_ts')).toBe('1700000000')
  })
})
