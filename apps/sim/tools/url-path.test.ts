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

  /**
   * The whole-value trim is retained for copy-paste hygiene, so whitespace at
   * the very start or end of the *entire* value is still removed. That is the
   * one remaining spelling this helper cannot address; whitespace anywhere
   * inside the value now survives.
   */
  it.concurrent('still trims only at the very edges of the whole value', () => {
    expect(safeUrlPath(' a/b.txt ', 'path')).toBe('a/b.txt')
    expect(safeUrlPath('a/ b .txt', 'path')).toBe('a/%20b%20.txt')
  })

  it.concurrent('trims the whole value but never an individual segment', () => {
    expect(safeUrlPath('  folder/file.jpg  ', 'path')).toBe('folder/file.jpg')
    expect(safeUrlPath('  folder / file.jpg  ', 'path')).toBe('folder%20/%20file.jpg')
  })

  /**
   * Supabase Storage's server-side `VALID_OBJECT_KEY` regex
   * (`/^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/`) includes a literal space, so
   * whitespace inside a segment is part of the key. Trimming it addressed a
   * different object and 404'd (or returned the wrong file) with no error.
   */
  it.concurrent('preserves whitespace inside a segment, which is a legal storage key', () => {
    const value = 'folder/ report .csv'
    const encoded = safeUrlPath(value, 'path')
    const url = new URL(`${ORIGIN}/storage/v1/object/${encoded}`)
    const segments = url.pathname.split('/')

    expect(segments.slice(4).map(decodeURIComponent).join('/')).toBe(value)
    expect(segments[5]).toBe('%20report%20.csv')
  })

  it.concurrent.each([
    'a/ leading.txt',
    'a/trailing.txt /b',
    'a/ b /c.txt',
    'my report.csv',
    'folder/ /file.txt',
  ] as const)('round-trips %j unchanged', (value) => {
    const url = new URL(`${ORIGIN}/storage/v1/object/${safeUrlPath(value, 'path')}`)

    expect(url.pathname.split('/').slice(4).map(decodeURIComponent).join('/')).toBe(value)
  })

  /**
   * A whitespace-only segment is ALLOWED: Supabase's charset permits a folder
   * literally named `" "`, it is structurally non-empty, and encoding it to
   * `%20` keeps the path shape intact. Only a genuinely empty segment is
   * rejected.
   */
  it.concurrent('allows a whitespace-only segment but still rejects an empty one', () => {
    expect(safeUrlPath('a/ /b', 'path')).toBe('a/%20/b')
    expect(new URL(`${ORIGIN}/o/${safeUrlPath('a/ /b', 'path')}`).pathname).toBe('/o/a/%20/b')
    expect(() => safeUrlPath('a//b', 'path')).toThrow(/path/)
  })

  /**
   * Dropping the per-segment trim must not re-open traversal. The WHATWG
   * parser only removes a segment that is *exactly* `.` or `..`; a padded one
   * encodes to inert text and stays put.
   */
  it.concurrent.each(['a/ .. /b', 'a/ ../b', 'a/.. /b', 'a/ . /b'] as const)(
    'keeps the padded dot segment %j inert instead of popping a segment',
    (value) => {
      const url = new URL(`${ORIGIN}/storage/v1/object/${safeUrlPath(value, 'path')}`)

      expect(url.pathname.split('/')).toHaveLength(7)
      expect(url.pathname.startsWith('/storage/v1/object/')).toBe(true)
      expect(url.pathname).not.toContain('/../')
      expect(url.pathname).not.toMatch(/\/\.\.$/)
    }
  )

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

/**
 * The guards replaced bare `${params.id}` templates at call sites where a
 * numeric-looking id (Stripe `id`, Spotify ids, X `woeid`) could arrive as a
 * JSON number. Coercing a non-string to `''` reported it as missing.
 */
describe('non-string inputs', () => {
  it.concurrent.each([
    [123, '123'],
    [0, '0'],
    [1.5, '1.5'],
    [-7, '-7'],
    [2487956, '2487956'],
  ] as const)('stringifies the number %j to %j instead of throwing', (value, expected) => {
    expect(safeUrlPathSegment(value, 'woeid')).toBe(expected)
    expect(safeUrlPath(value, 'woeid')).toBe(expected)
  })

  it.concurrent('keeps a numeric id addressable in the built URL', () => {
    const url = new URL(`${ORIGIN}/v1/trends/${safeUrlPathSegment(2487956, 'woeid')}`)

    expect(url.pathname).toBe('/v1/trends/2487956')
  })

  /**
   * `String(null)` is `'null'` and `String(undefined)` is `'undefined'` — both
   * truthy — so these must be rejected before coercion or the request would
   * silently address a resource literally named "null".
   */
  it.concurrent.each([
    ['null', null],
    ['undefined', undefined],
  ] as const)('still throws the required error for %s', (_label, value) => {
    expect(() => safeUrlPathSegment(value as unknown as string, 'id')).toThrow(/id is required/)
    expect(() => safeUrlPath(value as unknown as string, 'id')).toThrow(/id is required/)
  })

  it.concurrent('never lets null or undefined reach the path as literal text', () => {
    for (const value of [null, undefined]) {
      let built: string | null = null
      try {
        built = `${ORIGIN}/v1/${safeUrlPathSegment(value as unknown as string, 'id')}`
      } catch {
        continue
      }
      expect(built).toBeNull()
    }
  })

  it.concurrent('applies the dot-segment guard to a coerced value too', () => {
    expect(() => safeUrlPathSegment({ toString: () => '..' } as unknown as string, 'id')).toThrow(
      /id/
    )
    expect(() => safeUrlPath({ toString: () => 'a/../b' } as unknown as string, 'id')).toThrow(/id/)
  })
})
