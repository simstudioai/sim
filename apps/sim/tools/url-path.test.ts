/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { safeUrlPath, safeUrlPathSegment } from '@/tools/url-path'

const ORIGIN = 'https://api.example.com'

/**
 * Vectors that must be REJECTED outright — no encoding neutralizes them.
 */
const SEGMENT_REJECTED = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..', '', '   '] as const

const PATH_REJECTED = [
  '..',
  '.',
  '  ..  ',
  '\\..\\..',
  '/leading',
  'trailing/',
  'a//b',
  'a/../b',
  '',
  '   ',
] as const

/**
 * Vectors that must NOT throw because `encodeURIComponent` turns them into
 * literal names (`%` and `?` are escaped), leaving the path shape intact.
 */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

describe('the premise these helpers exist for', () => {
  it.concurrent('encodeURIComponent does not escape a dot segment', () => {
    expect(encodeURIComponent('..')).toBe('..')
    expect(encodeURIComponent('.')).toBe('.')
  })

  it.concurrent('the WHATWG parser removes dot segments after decoding', () => {
    expect(new URL('https://x/v1/a/b/..').pathname).toBe('/v1/a/')
    expect(new URL('https://x/v1/a/b/%2e%2e').pathname).toBe('/v1/a/')
  })
})

describe('safeUrlPathSegment', () => {
  it.concurrent.each(SEGMENT_REJECTED)('rejects %j', (value) => {
    expect(() => safeUrlPathSegment(value, 'table')).toThrow(/table/)
  })

  it.concurrent.each(NEUTRALIZED)('neutralizes %j into one literal segment', (value) => {
    const built = `${ORIGIN}/rest/v1/${safeUrlPathSegment(value, 'table')}?select=*`
    const url = new URL(built)
    const segments = url.pathname.split('/')

    expect(segments).toHaveLength(4)
    expect(segments[0]).toBe('')
    expect(segments[1]).toBe('rest')
    expect(segments[2]).toBe('v1')
    expect(decodeURIComponent(segments[3])).toBe(value)
    expect(url.searchParams.get('foo')).toBeNull()
    expect(url.searchParams.get('select')).toBe('*')
  })

  it.concurrent.each([
    'my-file.v2.txt',
    '..foo',
    'foo..',
    'users',
    '3f1c9a1e-6f27-4b2e-9b0f-2a1d4e5c6b7a',
  ])('preserves %j byte-identically', (value) => {
    const built = `${ORIGIN}/rest/v1/${safeUrlPathSegment(value, 'table')}`
    const segments = new URL(built).pathname.split('/')

    expect(segments).toHaveLength(4)
    expect(decodeURIComponent(segments[3])).toBe(value)
  })

  it.concurrent('trims surrounding whitespace', () => {
    expect(safeUrlPathSegment('  users  ', 'table')).toBe('users')
  })

  it.concurrent('every vector either throws or keeps the exact path shape', () => {
    for (const value of [...SEGMENT_REJECTED, ...NEUTRALIZED]) {
      let built: string | null = null
      try {
        built = `${ORIGIN}/rest/v1/${safeUrlPathSegment(value, 'table')}`
      } catch {
        continue
      }
      const segments = new URL(built).pathname.split('/')
      expect(segments).toHaveLength(4)
      expect(segments[1]).toBe('rest')
      expect(segments[2]).toBe('v1')
      expect(segments[3]).not.toBe('')
    }
  })
})

describe('safeUrlPath', () => {
  it.concurrent.each(PATH_REJECTED)('rejects %j', (value) => {
    expect(() => safeUrlPath(value, 'path')).toThrow(/path/)
  })

  it.concurrent.each(NEUTRALIZED)('neutralizes %j into one literal segment', (value) => {
    const built = `${ORIGIN}/storage/v1/object/${safeUrlPath(value, 'path')}?select=*`
    const url = new URL(built)
    const segments = url.pathname.split('/')

    expect(segments).toHaveLength(5)
    expect(segments[1]).toBe('storage')
    expect(segments[2]).toBe('v1')
    expect(segments[3]).toBe('object')
    expect(decodeURIComponent(segments[4])).toBe(value)
    expect(url.searchParams.get('foo')).toBeNull()
  })

  it.concurrent.each([
    ['folder/file.jpg', 2],
    ['src/lib/foo.ts', 3],
    ['my-file.v2.txt', 1],
    ['..foo', 1],
    ['foo..', 1],
    ['3f1c9a1e-6f27-4b2e-9b0f-2a1d4e5c6b7a', 1],
  ] as const)('preserves %j across %i segment(s)', (value, expectedSegments) => {
    const encoded = safeUrlPath(value, 'path')
    const built = `${ORIGIN}/storage/v1/object/${encoded}`
    const segments = new URL(built).pathname.split('/')

    expect(segments).toHaveLength(4 + expectedSegments)
    expect(segments[1]).toBe('storage')
    expect(segments.slice(4).map(decodeURIComponent).join('/')).toBe(value)
  })

  it.concurrent('keeps separators as literal slashes, never %2F', () => {
    const encoded = safeUrlPath('src/lib/foo.ts', 'path')

    expect(encoded).toBe('src/lib/foo.ts')
    expect(encoded).not.toContain('%2F')
    expect(encoded).not.toContain('%2f')
    expect(new URL(`${ORIGIN}/storage/v1/object/${encoded}`).pathname).toBe(
      '/storage/v1/object/src/lib/foo.ts'
    )
  })

  it.concurrent('encodes reserved characters inside a segment', () => {
    const encoded = safeUrlPath('folder/a b#c?d.txt', 'path')
    const url = new URL(`${ORIGIN}/storage/v1/object/${encoded}`)

    expect(url.pathname.split('/')).toHaveLength(6)
    expect(url.hash).toBe('')
    expect(url.search).toBe('')
    expect(decodeURIComponent(url.pathname.split('/')[5])).toBe('a b#c?d.txt')
  })

  it.concurrent('trims whitespace around each segment', () => {
    expect(safeUrlPath('  folder / file.jpg  ', 'path')).toBe('folder/file.jpg')
  })

  it.concurrent('every vector either throws or keeps the fixed prefix shape', () => {
    for (const value of [...PATH_REJECTED, ...NEUTRALIZED, 'folder/file.jpg']) {
      let built: string | null = null
      try {
        built = `${ORIGIN}/storage/v1/object/${safeUrlPath(value, 'path')}`
      } catch {
        continue
      }
      const segments = new URL(built).pathname.split('/')
      expect(segments.length).toBeGreaterThanOrEqual(5)
      expect(segments[1]).toBe('storage')
      expect(segments[2]).toBe('v1')
      expect(segments[3]).toBe('object')
      expect(segments.slice(4).every((segment) => segment !== '')).toBe(true)
    }
  })
})
