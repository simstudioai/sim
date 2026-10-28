import { toRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { bufferGetIdeasTool } from '@/tools/buffer/get_ideas'

describe('Buffer idea group filtering', () => {
  it.each([{ groups: ['group-1'], membership: null }, '{"groups":["group-1"],"membership":null}'])(
    'rejects a second OneOf field even when it is null: %j',
    (groupFilter) => {
      const body = bufferGetIdeasTool.request.body
      if (typeof body !== 'function') throw new Error('Missing idea query builder')

      expect(() =>
        body({ apiKey: 'buffer-key', organizationId: 'organization-1', groupFilter })
      ).toThrow('IdeasInput.groupFilter requires exactly one field')
    }
  )

  it('omits an undefined sibling from an explicit group filter', () => {
    const body = bufferGetIdeasTool.request.body
    if (typeof body !== 'function') throw new Error('Missing idea query builder')

    const request = toRecord(
      body({
        apiKey: 'buffer-key',
        organizationId: 'organization-1',
        groupFilter: { groups: ['group-1'], membership: undefined },
      })
    )

    expect(toRecord(toRecord(request.variables).input).groupFilter).toEqual({ groups: ['group-1'] })
  })
})
