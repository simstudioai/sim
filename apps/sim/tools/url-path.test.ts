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
   * The parser removes the percent-encoded spellings too, not just the two
   * literal ones. The guard below matches only the literal spellings, which is
   * sufficient solely because `encodeURIComponent` escapes `%` and so can never
   * emit a `%2e` form. Both halves are asserted here, because the second is
   * what makes the first safe. Every case-and-mixing combination of the one-
   * and two-dot forms is enumerated rather than counted in prose.
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
    ['%2e%2E', '/v1/'],
    ['%2E%2e', '/v1/'],
    ['%2E%2E', '/v1/'],
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

/**
 * Tool params are declared `type: 'string'` but nothing enforces that before
 * the value reaches the guard: an LLM tool call or stored workflow state can
 * hand a numeric-looking id over as a JSON number. Coercing a non-string to
 * `''` reported such a value as missing, which names the wrong problem.
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
  })
})

/**
 * The coercion is deliberately narrow. It exists so an id the caller genuinely
 * supplied as a JSON number is not reported as missing, and it must not be a
 * general `String(value)` — that turns a wrong-shaped value into a plausible
 * but wrong path segment instead of a clean, named error.
 */
describe('coercion boundary', () => {
  it.concurrent.each([
    ['string', 'abc', 'abc'],
    ['zero', 0, '0'],
    ['negative', -7, '-7'],
    ['decimal', 1.5, '1.5'],
    ['bigint', 42n, '42'],
    ['large safe integer', 9007199254740991, '9007199254740991'],
  ] as const)('accepts the %s as the expected string', (_label, value, expected) => {
    expect(safeUrlPathSegment(value as never, 'id')).toBe(expected)
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
    let thrown: unknown = null
    try {
      safeUrlPathSegment(value as never, 'objectId')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('objectId')
    expect((thrown as Error).message).not.toContain('[object')
    expect((thrown as Error).message).not.toMatch(/No default value/)
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
    expect(() => safeUrlPathSegment(value as never, 'objectId')).toThrow(/objectId is required/)
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
 * `JSON.parse` accepts a lone-surrogate escape (`"\ud83d"`, a truncated emoji
 * from an LLM tool call), so an unpaired surrogate reaches the guard as an
 * ordinary string that every other check passes. `encodeURIComponent` throws a
 * bare `URIError` on it, which loses the parameter name this module promises
 * every failure carries.
 */
describe('lone surrogates', () => {
  const LONE_SURROGATES = [
    JSON.parse('{"v":"dpl_\\ud83d"}').v,
    JSON.parse('{"v":"\\udc4d_tail"}').v,
    JSON.parse('{"v":"a\\ud800b"}').v,
  ] as const

  it.concurrent.each(LONE_SURROGATES)("rejects %j with this module's named error", (value) => {
    let thrown: unknown = null
    try {
      safeUrlPathSegment(value, 'deploymentId')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(URIError)
    expect((thrown as Error).message).toContain('deploymentId')
  })

  it.concurrent('keeps a WELL-PAIRED surrogate working', () => {
    expect(safeUrlPathSegment('dpl_😀', 'deploymentId')).toBe(`dpl_${encodeURIComponent('😀')}`)
  })
})

/**
 * A tiny exponential (`1e-7`) round-trips through `String`/`Number` exactly, so
 * the "too large to be represented exactly" message is factually wrong for it.
 * The rejection is kept — an exponential spelling is not a usable identifier in
 * any provider path — but the message must say that, and the genuinely
 * imprecise large values must keep the precision message.
 */
describe('exponential number spellings', () => {
  it.concurrent.each([1e-7, 1.5e-7, 1e-21, 5e-324, -1e-7] as const)(
    'rejects the tiny exponential %j without claiming it is too large',
    (value) => {
      expect(Number(String(value))).toBe(value)

      let thrown: unknown = null
      try {
        safeUrlPathSegment(value, 'woeid')
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toContain('woeid')
      expect((thrown as Error).message).not.toContain('too large')
      expect((thrown as Error).message).toContain('exponential')
    }
  )

  it.concurrent.each([1e21, 1.5e300, Number.MAX_SAFE_INTEGER + 2] as const)(
    'keeps the precision message for the imprecise large value %j',
    (value) => {
      expect(() => safeUrlPathSegment(value, 'woeid')).toThrow(/too large to be represented/)
    }
  )
})

/**
 * The 44 live call sites (Vercel x43, Daytona x1) pass provider ids and
 * hostnames, and every one of them interpolated `${params.id.trim()}` before
 * these guards existed — so a string is the only shape any of them has ever
 * handled, and a string's output must stay byte-identical across this change.
 * A numeric id is the newly accepted shape, not a restored one: it threw
 * `TypeError: .trim is not a function` at those same call sites before.
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

  it.concurrent('stringifies a numeric id these call sites used to reject', () => {
    expect(safeUrlPathSegment(2487956, 'deploymentId')).toBe('2487956')
    expect(safeUrlPathSegment(0, 'sandboxId')).toBe('0')
  })
})

/**
 * The two helpers take opposite positions on surrounding whitespace, and that
 * split is load-bearing in both directions — so both directions are pinned.
 *
 * An id is an opaque copy-pasted token, so whitespace around it is transport
 * noise. A path is content: a leading or trailing space is a legal filename
 * character that git stores verbatim, so trimming one silently addresses a
 * different file. See the TSDoc on `safeUrlPath` for the full reasoning.
 */
describe('whitespace handling differs by purpose', () => {
  it('trims an opaque identifier, because the padding is not part of the id', () => {
    expect(safeUrlPathSegment('  ecfg_abc123  ', 'edgeConfigId')).toBe('ecfg_abc123')
  })

  it.each([
    ['docs/my file .txt', 'docs/my%20file%20.txt'],
    ['docs/ leading.md', 'docs/%20leading.md'],
    ['docs/trailing.md ', 'docs/trailing.md%20'],
    [' leading-dir/file.md', '%20leading-dir/file.md'],
    ['docs/trailing-dir /file.md', 'docs/trailing-dir%20/file.md'],
  ])('preserves %j byte-for-byte as a path', (value, expected) => {
    expect(safeUrlPath(value, 'path')).toBe(expected)
  })

  it('round-trips a padded filename through the URL parser unchanged', () => {
    const url = new URL(`${ORIGIN}/repos/o/r/contents/${safeUrlPath('docs/my file .txt', 'path')}`)

    expect(url.pathname).toBe('/repos/o/r/contents/docs/my%20file%20.txt')
    expect(decodeURIComponent(url.pathname)).toBe('/repos/o/r/contents/docs/my file .txt')
  })

  it.each([
    ['docs/   /file.txt', 'docs/%20%20%20/file.txt'],
    ['   ', '%20%20%20'],
    ['e/   /f.txt', 'e/%20%20%20/f.txt'],
    ['d/   ', 'd/%20%20%20'],
  ])('permits the whitespace-only component in %j', (value, expected) => {
    expect(safeUrlPath(value, 'path')).toBe(expected)
  })

  it('round-trips a whitespace-only component through the URL parser', () => {
    const url = new URL(`${ORIGIN}/repos/o/r/contents/${safeUrlPath('docs/   /file.txt', 'path')}`)

    expect(url.pathname).toBe('/repos/o/r/contents/docs/%20%20%20/file.txt')
    expect(decodeURIComponent(url.pathname)).toBe('/repos/o/r/contents/docs/   /file.txt')
  })

  it('rejects only a truly empty component', () => {
    expect(() => safeUrlPath('docs//file.txt', 'path')).toThrow(/empty path segment/)
  })

  it('still rejects an opaque id that is only whitespace, since it trims first', () => {
    expect(() => safeUrlPathSegment('   ', 'edgeConfigId')).toThrow(/edgeConfigId is required/)
  })

  it('still rejects a dot segment inside a path', () => {
    expect(() => safeUrlPath('docs/../../etc/passwd', 'path')).toThrow(
      /path traversal is not allowed/
    )
  })

  it('leaves a space-wrapped dot segment inert rather than rejecting it', () => {
    const url = new URL(`${ORIGIN}/repos/o/r/contents/${safeUrlPath('docs/ .. /x', 'path')}`)

    expect(url.pathname).toBe('/repos/o/r/contents/docs/%20..%20/x')
  })

  it('rejects a backslash anywhere in a path', () => {
    expect(() => safeUrlPath('docs\\..\\..', 'path')).toThrow(/cannot contain a backslash/)
  })

  it('keeps a colon so a cross-fork compare ref still addresses its owner', () => {
    expect(safeUrlPath('octocat:feature/my-branch', 'base')).toBe('octocat:feature/my-branch')
  })
})
