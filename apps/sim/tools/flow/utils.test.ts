import { describe, expect, it } from 'vitest'
import { flowIds } from '@/tools/flow/utils'

describe('Flow entity ID lists', () => {
  it.each(['id-a,,id-b', ',id-a', 'id-a,', 'id-a, \t ,id-b'])(
    'rejects missing IDs in %j rather than reading a partial selection',
    (value) => {
      expect(() => flowIds(value)).toThrow('entityIds is required')
    }
  )

  it('preserves every selected ID while trimming surrounding whitespace', () => {
    expect(flowIds(' id-a , id-b ')).toEqual(['id-a', 'id-b'])
  })
})
