import { toRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { bufferGetPostsTool } from '@/tools/buffer/get_posts'

describe('Buffer post ordering', () => {
  it.each([
    {
      sort: [{ field: 'createdAt', direction: 'desc' }],
      sortBy: 'unused-field',
      sortDirection: 'asc',
    },
    {
      sort: '[{"field":"createdAt","direction":"desc"}]',
      sortBy: 'dueAt',
      sortDirection: 'unused-direction',
    },
  ])('uses explicit ordering despite unused legacy values: $sortBy / $sortDirection', (sorting) => {
    const body = bufferGetPostsTool.request.body
    if (typeof body !== 'function') throw new Error('Missing post query builder')

    const request = toRecord(
      body({
        apiKey: 'buffer-key',
        organizationId: 'organization-1',
        ...sorting,
      })
    )
    const input = toRecord(toRecord(request.variables).input)

    expect(input.sort).toEqual([{ field: 'createdAt', direction: 'desc' }])
  })
})
