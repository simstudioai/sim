import { describe, expect, it } from 'vitest'
import { parseTailscaleList } from '@/tools/tailscale/utils'

describe('Tailscale replacement lists', () => {
  it.each(['', '   ', ', ,', '[" "]'])(
    'rejects ambiguous empty input %j before it can clear configuration',
    (value) => {
      expect(() => parseTailscaleList(value)).toThrow('Use []')
    }
  )

  it('allows explicit clearing and trims a populated replacement list', () => {
    expect(parseTailscaleList('[]')).toEqual([])
    expect(parseTailscaleList('1.1.1.1, 8.8.8.8')).toEqual(['1.1.1.1', '8.8.8.8'])
  })
})
