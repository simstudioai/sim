/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { safeOpaqueUrlSegment, safeUrlPath, safeUrlPathSegment } from '@/tools/url-path'

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

  /**
   * The removable set is the ELEVEN spellings the URL Standard defines, not
   * just the two literal ones. The helpers below match only the literal
   * spellings, which is sufficient solely because `encodeURIComponent` escapes
   * `%` and so can never emit a `%2e` form. Both halves are asserted here,
   * because the second is what makes the first safe.
   */
  it.concurrent.each([
    ['.', '/v1/a/'],
    ['%2e', '/v1/a/'],
    ['%2E', '/v1/a/'],
    ['..', '/v1/'],
    ['.%2e', '/v1/'],
    ['.%2E', '/v1/'],
    ['%2e.', '/v1/'],
    ['%2E.', '/v1/'],
    ['%2e%2e', '/v1/'],
    ['%2E%2E', '/v1/'],
    ['%2e%2E', '/v1/'],
  ] as const)(
    'the parser also removes the encoded dot-segment spelling %j (=> %j)',
    (spelling, expected) => {
      expect(new URL(`https://x/v1/a/${spelling}`).pathname).toBe(expected)
    }
  )

  it.concurrent.each(['...', '%2e%2e%2e', '%252e', 'a%2e'])(
    'the parser does NOT remove %j',
    (spelling) => {
      expect(new URL(`https://x/v1/a/${spelling}`).pathname.startsWith('/v1/a/')).toBe(true)
    }
  )

  it.concurrent('encodeURIComponent escapes % so no helper can emit a %2e spelling', () => {
    expect(encodeURIComponent('%2e%2e')).toBe('%252e%252e')
    expect(new URL('https://x/v1/a/%252e%252e').pathname).toBe('/v1/a/%252e%252e')
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
   * By DEFAULT the whole-value trim is retained for copy-paste hygiene across
   * the ~700 call sites that rely on it, so whitespace at the very start or
   * end of the *entire* value is removed. Whitespace anywhere inside the value
   * survives. A caller whose provider treats outer whitespace as part of the
   * key — Supabase Storage does — opts out with `preserveOuterWhitespace`,
   * covered in the options describe below.
   */
  it.concurrent('still trims only at the very edges of the whole value by default', () => {
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
   * parser removes a segment only when the whole segment spells a dot segment
   * — literally or percent-encoded — and a padded one spells neither, so it
   * encodes to inert text and stays put. The percent-encoded spellings are
   * unreachable from here because `encodeURIComponent` escapes `%` itself.
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

/**
 * The opt-in relaxations exist for exactly one provider fact: Supabase
 * Storage's server-side key allowlist,
 * `/^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/` (`supabase/storage`
 * `src/storage/limits.ts`). It permits `/` freely and never collapses runs of
 * it, and it includes a literal space, so `a//b`, `/leading`, `trailing/`, and
 * `' report.csv'` are all real, distinct, addressable objects. Both options
 * default to off, so every other call site is byte-identical.
 */
describe('safeUrlPath options', () => {
  const STORAGE = { allowEmptySegments: true, preserveOuterWhitespace: true } as const

  it.concurrent('defaults to the strict behavior when options are omitted or empty', () => {
    for (const options of [undefined, {}]) {
      expect(() => safeUrlPath('a//b', 'path', options)).toThrow(/path/)
      expect(() => safeUrlPath('/leading', 'path', options)).toThrow(/path/)
      expect(() => safeUrlPath('trailing/', 'path', options)).toThrow(/path/)
      expect(safeUrlPath(' a/b.txt ', 'path', options)).toBe('a/b.txt')
    }
  })

  it.concurrent.each([
    ['a//b', 'a//b'],
    ['/leading', '/leading'],
    ['trailing/', 'trailing/'],
    ['a//b//c', 'a//b//c'],
    ['/', '/'],
  ] as const)('allowEmptySegments keeps %j as %j', (value, expected) => {
    expect(safeUrlPath(value, 'path', { allowEmptySegments: true })).toBe(expected)
  })

  it.concurrent.each([
    [' report.csv', '%20report.csv'],
    ['report.csv ', 'report.csv%20'],
    [' a/b ', '%20a/b%20'],
    [' ', '%20'],
  ] as const)('preserveOuterWhitespace keeps %j as %j', (value, expected) => {
    expect(safeUrlPath(value, 'path', { preserveOuterWhitespace: true })).toBe(expected)
  })

  it.concurrent('still rejects a genuinely empty value under both options', () => {
    expect(() => safeUrlPath('', 'path', STORAGE)).toThrow(/path is required/)
  })

  /**
   * Neither option touches the dot-segment check. An exact match on the raw
   * segment suffices because every segment then goes through
   * `encodeURIComponent`, which escapes `%` and so cannot emit the
   * percent-encoded dot-segment spellings the parser also removes.
   */
  it.concurrent.each(['a//../b', '/..', '../', '..', '.', 'a/../b', '/a/./b', '..//..'] as const)(
    'still rejects the dot segment in %j under storage options',
    (value) => {
      expect(() => safeUrlPath(value, 'path', STORAGE)).toThrow(/path/)
    }
  )

  it.concurrent('still rejects a backslash under storage options', () => {
    expect(() => safeUrlPath('a\\..\\b', 'path', STORAGE)).toThrow(/backslash/)
  })

  it.concurrent.each(['a//b', '/leading', 'trailing/', ' report.csv', 'a/ b /c'] as const)(
    'the URL parser preserves %j verbatim under storage options',
    (value) => {
      const url = new URL(`${ORIGIN}/storage/v1/object/bkt/${safeUrlPath(value, 'path', STORAGE)}`)

      expect(url.pathname).toBe(
        `/storage/v1/object/bkt/${value.split('/').map(encodeURIComponent).join('/')}`
      )
      expect(url.pathname.startsWith('/storage/v1/object/bkt/')).toBe(true)
      expect(url.hash).toBe('')
      expect(url.search).toBe('')
    }
  )

  it.concurrent('keeps the null/undefined rejection and number coercion', () => {
    expect(safeUrlPath(12345, 'path', STORAGE)).toBe('12345')
    expect(() => safeUrlPath(null as unknown as string, 'path', STORAGE)).toThrow(
      /path is required/
    )
    expect(() => safeUrlPath(undefined as unknown as string, 'path', STORAGE)).toThrow(
      /path is required/
    )
  })
})

/**
 * `safeOpaqueUrlSegment` is the third position between the two helpers above:
 * a `/` is neither rejected (as `safeUrlPathSegment` does) nor emitted as a
 * real separator (as `safeUrlPath` does), but percent-encoded to `%2F` so the
 * whole value stays one inert segment. Only an exact `.` or `..` is rejected,
 * because that is the only spelling no encoding neutralizes.
 */
describe('safeOpaqueUrlSegment', () => {
  it.concurrent.each(['..', '.', '  ..  ', '', '   '])('rejects %j', (value) => {
    expect(() => safeOpaqueUrlSegment(value, 'objectID')).toThrow(/objectID/)
  })

  it.concurrent.each([
    'foo/bar',
    'https://example.com/docs/getting-started',
    'Batman and Robin',
    'a/../../b',
    'docs/',
    '/leading',
    'a//b',
    '\\..\\..',
    '%2e%2e',
    'x?foo=attacker',
  ])('collapses %j into one inert segment', (value) => {
    const url = new URL(`${ORIGIN}/1/indexes/idx/${safeOpaqueUrlSegment(value, 'objectID')}`)
    const segments = url.pathname.split('/')

    expect(segments).toHaveLength(5)
    expect(segments.slice(0, 4)).toEqual(['', '1', 'indexes', 'idx'])
    expect(decodeURIComponent(segments[4])).toBe(value)
    expect(url.searchParams.get('foo')).toBeNull()
  })

  it.concurrent.each(['obj-123', 'my.record.v2', '..foo', 'foo..', 'products'])(
    'preserves %j byte-identically',
    (value) => {
      expect(safeOpaqueUrlSegment(value, 'objectID')).toBe(value)
    }
  )

  it.concurrent('trims and stringifies like the other helpers', () => {
    expect(safeOpaqueUrlSegment('  obj-1  ', 'objectID')).toBe('obj-1')
    expect(safeOpaqueUrlSegment(9_000_001, 'objectID')).toBe('9000001')
    expect(() => safeOpaqueUrlSegment(null as unknown as string, 'objectID')).toThrow(/required/)
    expect(() => safeOpaqueUrlSegment(undefined as unknown as string, 'objectID')).toThrow(
      /required/
    )
  })

  it.concurrent('differs from both neighbours on the same slashed value', () => {
    expect(() => safeUrlPathSegment('foo/bar', 'objectID')).toThrow(/separator/)
    expect(safeUrlPath('foo/bar', 'objectID')).toBe('foo/bar')
    expect(safeOpaqueUrlSegment('foo/bar', 'objectID')).toBe('foo%2Fbar')
  })
})

/**
 * The coercion is deliberately narrow. It exists so an id the caller genuinely
 * supplied as a JSON number is not reported as missing, and it must not be a
 * general `String(value)` — that turns a wrong-shaped value into a plausible
 * but wrong path segment instead of a clean, named error.
 */
describe('coercion boundary', () => {
  const HELPERS = [
    ['safeUrlPathSegment', safeUrlPathSegment],
    ['safeUrlPath', safeUrlPath],
    ['safeOpaqueUrlSegment', safeOpaqueUrlSegment],
  ] as const

  it.concurrent.each([
    ['string', 'abc', 'abc'],
    ['zero', 0, '0'],
    ['negative', -7, '-7'],
    ['decimal', 1.5, '1.5'],
    ['bigint', 42n, '42'],
    ['large safe integer', 9007199254740991, '9007199254740991'],
  ] as const)('accepts the %s as the expected string', (_label, value, expected) => {
    for (const [name, helper] of HELPERS) {
      expect(`${name}:${helper(value as never, 'id')}`).toBe(`${name}:${expected}`)
    }
  })

  it.concurrent.each([
    ['plain object', {}],
    ['populated object', { a: 1 }],
    ['Map', new Map()],
    ['null-prototype object', Object.create(null)],
    ['true', true],
    ['false', false],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['array', [1, 2]],
    ['Date', new Date(0)],
    ['symbol', Symbol('s')],
    ['exponential number', 1e21],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 2],
    ['snowflake-sized id parsed as a number', Number('1234567890123456789')],
    ['function', () => 'x'],
  ] as const)('rejects the %s with an error naming the param', (_label, value) => {
    for (const [name, helper] of HELPERS) {
      let thrown: unknown = null
      try {
        helper(value as never, 'objectId')
      } catch (error) {
        thrown = error
      }
      expect(`${name}:${thrown instanceof Error}`).toBe(`${name}:true`)
      expect(`${name}:${(thrown as Error).message}`).toContain('objectId')
      expect((thrown as Error).message).not.toContain('[object')
      expect((thrown as Error).message).not.toMatch(/No default value/)
    }
  })

  /**
   * `null` and `undefined` keep reporting *"is required"* — the distinction
   * between "you sent nothing" and "you sent the wrong kind of thing" is what
   * makes the error actionable.
   */
  it.concurrent.each([
    ['null', null],
    ['undefined', undefined],
  ] as const)('keeps the required error for %s rather than the invalid-value one', (_l, value) => {
    for (const [name, helper] of HELPERS) {
      expect(() => helper(value as never, 'objectId')).toThrow(/objectId is required/)
      expect(`${name}`).toBe(name)
    }
  })

  it.concurrent('never lets a rejected value reach the built path', () => {
    for (const value of [{}, true, Number.NaN, [1, 2], 1e21, new Date(0)]) {
      let built: string | null = null
      try {
        built = `${ORIGIN}/v1/${safeUrlPathSegment(value as never, 'id')}`
      } catch {
        continue
      }
      expect(built).toBeNull()
    }
  })
})

/**
 * The 44 live call sites (Vercel x43, Daytona x1) pass provider ids and
 * hostnames as strings, occasionally a numeric id. Their output must be
 * byte-identical across this change.
 */
describe('live call-site values', () => {
  it.concurrent.each([
    'prj_2rXy9Qh0lE8vJmKpZ4aB1cD',
    'dpl_9fJk2LmN4pQr7sT1uV3wX5yZ',
    'team_abcDEF123',
    'my-app.vercel.app',
    'example.com',
    'sub.domain.example.co.uk',
    'rec_1a2b3c',
    'ecfg_xyz',
    '3f1c9a1e-6f27-4b2e-9b0f-2a1d4e5c6b7a',
  ])('passes %j through unchanged', (value) => {
    expect(safeUrlPathSegment(value, 'id')).toBe(value)
  })

  it.concurrent('still stringifies a numeric id', () => {
    expect(safeUrlPathSegment(2487956, 'woeid')).toBe('2487956')
    expect(safeUrlPathSegment(0, 'folderId')).toBe('0')
  })
})

/**
 * The rejection set is NOT option-invariant: `' .. '` trims to the exact dot
 * segment under the default and is therefore rejected, while
 * `preserveOuterWhitespace` keeps it as inert `%20..%20` text that the WHATWG
 * parser leaves in place.
 */
describe('preserveOuterWhitespace changes the rejection set', () => {
  it.concurrent('rejects " .. " by default but accepts it as inert text with the option', () => {
    expect(() => safeUrlPath(' .. ', 'path')).toThrow(/path/)
    expect(safeUrlPath(' .. ', 'path', { preserveOuterWhitespace: true })).toBe('%20..%20')

    const url = new URL(
      `${ORIGIN}/storage/v1/object/bkt/${safeUrlPath(' .. ', 'path', { preserveOuterWhitespace: true })}`
    )
    expect(url.pathname).toBe('/storage/v1/object/bkt/%20..%20')
    expect(url.pathname).not.toContain('/../')
  })

  it.concurrent('rejects " . " by default but keeps it inert with the option', () => {
    expect(() => safeUrlPath(' . ', 'path')).toThrow(/path/)
    expect(safeUrlPath(' . ', 'path', { preserveOuterWhitespace: true })).toBe('%20.%20')
  })

  it.concurrent('still rejects an untrimmed exact dot segment under the option', () => {
    expect(() => safeUrlPath('..', 'path', { preserveOuterWhitespace: true })).toThrow(/path/)
    expect(() => safeUrlPath('a/../b', 'path', { preserveOuterWhitespace: true })).toThrow(/path/)
  })
})
