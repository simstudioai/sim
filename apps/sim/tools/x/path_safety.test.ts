/**
 * @vitest-environment node
 *
 * Guards every X tool against path traversal through an LLM-writable identifier
 * that gets interpolated into the request path.
 *
 * `userId`, `targetUserId`, `tweetId`, `username`, and `woeid` are
 * `visibility: 'user-or-llm'`, so prompt injection controls them. These call
 * sites interpolated the raw value — `params.userId.trim()` — with no encoding
 * at all, so a value like `../../users/victim/following` escaped its API prefix
 * once `fetch` normalized the URL, re-aiming the request and the user's X OAuth
 * token at a different resource, including on the DELETE routes that unfollow,
 * unblock, or delete a post.
 *
 * `encodeURIComponent` alone would not have closed it, which is why the bare
 * `.` and `..` vectors below are the point of this file: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * X ids are numeric snowflakes, and an LLM tool call can serialize one as a
 * JSON **number** rather than a string. `NUMERIC_IDS` below pins that a
 * safe-integer id still reaches the path as its own decimal text, and the final
 * case pins that a snowflake too large for a `double` — already corrupted by
 * `JSON.parse` before any tool sees it — is refused by name instead of being
 * silently sent as the wrong id.
 */
import { describe, expect, it } from 'vitest'
import type { ToolConfig } from '@/tools/types'
import * as xTools from '@/tools/x/index'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix would look correct while the hole stayed live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../users/victim',
  '..%2f..%2fusers/victim',
  '783214/../../2/tweets/1',
  '783214?expansions=author_id',
  '783214#fragment',
  'tweets/../../../2/users/me',
  '\\..\\..',
] as const

/**
 * Values a real X caller supplies — numeric snowflake ids and handles; none may
 * be rejected, and none may reach the wire as a different value.
 */
const LEGITIMATE_IDS = [
  '783214',
  '2244994945',
  '1234567890123456789',
  '1',
  'elonmusk',
  'XDevelopers',
  'X',
  'some_user_99',
  '..foo',
  'foo..',
] as const

/** Snowflake-shaped ids an LLM may emit as a JSON number rather than a string. */
const NUMERIC_IDS = [1, 783214, 2244994945] as const

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isXTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('x_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string | number): Record<string, unknown> {
  const params: Record<string, unknown> = { accessToken: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'accessToken') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = value
    }
  }
  return params
}

function buildUrl(tool: AnyTool, value: string | number): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, value) as any))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

const X_ORIGINS = ['https://api.x.com', 'https://api.twitter.com']

const DYNAMIC_PATH_TOOLS = Object.values(xTools)
  .filter(isXTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return segmentsOf(buildUrl(tool, SAFE_ID)).includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('x path-ID traversal safety', () => {
  it('covers every X tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(21)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildUrl(tool, SAFE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(X_ORIGINS).toContain(url.origin)

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) {
          expect(decodeURIComponent(actual[index])).toBe(value)
          return
        }
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(NUMERIC_IDS)('accepts %d supplied as a JSON number', (value) => {
      const actual = segmentsOf(buildUrl(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? String(value) : segment)
      })
    })

    it('refuses a snowflake too large to survive JSON number parsing', () => {
      const corrupted = Number('1234567890123456789')

      expect(String(corrupted)).not.toBe('1234567890123456789')
      expect(() => buildUrl(tool, corrupted)).toThrow(/too large/)
    })

    it('rejects a bare dot-dot segment instead of silently popping a segment', () => {
      expect(() => buildUrl(tool, '..')).toThrow(/path traversal/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow(/path traversal/)
    })

    it('does not let the ID inject query parameters', () => {
      expect(buildUrl(tool, '783214?expansions=author_id').searchParams.get('expansions')).not.toBe(
        'author_id'
      )
    })
  })
})
