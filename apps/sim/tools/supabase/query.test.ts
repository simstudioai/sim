import { describe, expect, it } from 'vitest'
import { queryTool } from '@/tools/supabase/query'

function orderParamFor(orderBy: string): string | null {
  const url = queryTool.request.url
  if (typeof url !== 'function') throw new Error('Expected a URL builder')
  return new URL(
    url({ apiKey: 'key', projectId: 'abcdefghijklmnopqrst', table: 'items', orderBy })
  ).searchParams.get('order')
}

describe('Supabase query order', () => {
  it('lowercases PostgREST direction and nulls modifiers but keeps the column name', () => {
    expect(orderParamFor('createdAt.DESC')).toBe('createdAt.desc')
    expect(orderParamFor('age.Desc.NULLSLAST')).toBe('age.desc.nullslast')
  })

  it('keeps the existing column and column DESC forms', () => {
    expect(orderParamFor('name')).toBe('name.asc')
    expect(orderParamFor('name DESC, id')).toBe('name.desc,id.asc')
  })
})
