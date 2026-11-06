import { describe, expect, it } from 'vitest'
import { buildZohoDeskBody, parseZohoDeskJson, readZohoDeskList } from '@/tools/zoho_desk/request'

describe('Zoho Desk mutation input', () => {
  it('preserves explicit clears and false values while omitting untouched inputs', () => {
    expect(buildZohoDeskBody({ lastName: null, email: '', isPublic: false, count: 0 })).toEqual({
      email: '',
      isPublic: false,
      count: 0,
    })
  })

  it('rejects serialized JSON with a different shape instead of sending it', () => {
    expect(() => parseZohoDeskJson('[]', 'customFields', 'object')).toThrow('object')
    expect(() => parseZohoDeskJson('{}', 'attachmentIds', 'array')).toThrow('array')
    expect(() => parseZohoDeskJson('{', 'customFields', 'object')).toThrow('JSON')
    expect(parseZohoDeskJson('{"cf_verified":false}', 'customFields', 'object')).toEqual({
      cf_verified: false,
    })
  })
})

describe('Zoho Desk list responses', () => {
  it('accepts a documented no-content page', async () => {
    await expect(readZohoDeskList(new Response(null, { status: 204 }))).resolves.toEqual({
      items: [],
      totalCount: null,
    })
  })

  it('rejects malformed successful responses instead of reporting an empty list', async () => {
    await expect(readZohoDeskList(new Response('not JSON'))).rejects.toThrow()
    await expect(readZohoDeskList(Response.json({ data: {} }))).rejects.toThrow('list')
  })

  it('preserves a search total separately from the current page size', async () => {
    await expect(
      readZohoDeskList(Response.json({ data: [{ id: '1' }], count: '42' }))
    ).resolves.toEqual({ items: [{ id: '1' }], totalCount: 42 })
  })
})
