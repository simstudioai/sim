import { describe, expect, it } from 'vitest'
import { planeApiUrl, planeBodyValue, planeRequestBody } from '@/tools/plane/utils'

describe('Plane instance URL boundary', () => {
  it('keeps a self-hosted path prefix while adding encoded query values', () => {
    const url = planeApiUrl('https://plane.example.com/plane/', '/api/v1/users/me/', {
      cursor: '20:1:0',
      search: 'a+b & c',
    })
    expect(new URL(url).pathname).toBe('/plane/api/v1/users/me/')
    expect(new URL(url).searchParams.get('cursor')).toBe('20:1:0')
    expect(new URL(url).searchParams.get('search')).toBe('a+b & c')
  })

  it.each([
    'https://token@plane.example.com',
    'https://plane.example.com?key=value',
    'https://plane.example.com#fragment',
    'file:///plane',
    'https://plane.example.com/api/v1',
    'https://plane.example.com/prefix/../other',
    'https://plane.example.com/prefix/%2e%2e/other',
  ])('rejects an ambiguous or credential-bearing instance URL: %s', (url) => {
    expect(() => planeApiUrl(url, '/api/v1/users/me/')).toThrow()
  })
})

describe('Plane partial update serialization', () => {
  it('preserves clearing a nullable field and replacing a list with an empty list', () => {
    expect(planeBodyValue(null, 'string', 'parent')).toBeNull()
    expect(planeBodyValue('[]', 'array', 'assignees')).toEqual([])
    expect(planeBodyValue(false, 'boolean', 'is_draft')).toBe(false)
    expect(planeBodyValue(0, 'integer', 'point')).toBe(0)
    expect(planeBodyValue('', 'string', 'description')).toBe('')
    expect(planeBodyValue(undefined, 'string', 'description')).toBeUndefined()
  })

  it.each([
    ['[1', 'array'],
    ['{}', 'array'],
    ['no', 'boolean'],
    ['not-a-number', 'integer'],
    [1.5, 'integer'],
    [Number.POSITIVE_INFINITY, 'number'],
    [true, 'number'],
    [[], 'number'],
    [{}, 'number'],
  ])('rejects malformed provider input %s (%s)', (value, type) => {
    expect(() => planeBodyValue(value, type, 'value')).toThrow()
  })
})

describe('Plane write overrides', () => {
  const fields = {
    name: { type: 'string', required: true },
    description_html: { type: 'string', required: false },
    parent: { type: 'string', required: false },
    assignees: { type: 'array', required: false },
  }

  it('allows explicit clears while preserving fields without an override', () => {
    expect(
      planeRequestBody(
        { name: 'Keep', description_html: 'Old', parent: 'parent-id' },
        '{"description_html":"","parent":null,"assignees":[]}',
        fields
      )
    ).toEqual({ name: 'Keep', description_html: '', parent: null, assignees: [] })
  })

  it('rejects unknown fields and missing required fields', () => {
    for (const name of ['apiKey', 'constructor', '__proto__']) {
      expect(() =>
        planeRequestBody({ name: 'Keep' }, JSON.stringify({ [name]: 'value' }), fields)
      ).toThrow()
    }
    expect(() => planeRequestBody({}, undefined, fields)).toThrow()
    expect(() => planeRequestBody({ name: 'Keep' }, { name: null }, fields)).toThrow()
  })
})
