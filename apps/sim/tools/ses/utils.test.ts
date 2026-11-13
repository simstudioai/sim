import { describe, expect, it } from 'vitest'
import { parseEmailTagsParam } from '@/tools/ses/utils'

describe('parseEmailTagsParam', () => {
  it('parses a JSON array string from an agent call', () => {
    expect(parseEmailTagsParam('[{"name":"campaign","value":"welcome"}]')).toEqual([
      { name: 'campaign', value: 'welcome' },
    ])
  })

  it.each(['not json', '{"name":"campaign","value":"welcome"}'])(
    'rejects %s instead of sending without tags',
    (value) => {
      expect(() => parseEmailTagsParam(value)).toThrow('Email tags must be a valid JSON array')
    }
  )

  it('leaves empty values unset', () => {
    expect(parseEmailTagsParam('  ')).toBeUndefined()
    expect(parseEmailTagsParam(undefined)).toBeUndefined()
  })
})
