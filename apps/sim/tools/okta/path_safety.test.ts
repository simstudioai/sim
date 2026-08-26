/**
 * @vitest-environment node
 *
 * Guards every Okta tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * Every path ID here is `visibility: 'user-or-llm'`, so prompt injection
 * controls it. These tools previously wrapped each ID in `encodeURIComponent`,
 * which looks like a guard and is not: `.` and `..` are unreserved, so they
 * survive encoding verbatim, and the WHATWG parser removes dot segments after
 * decoding. `new URL('https://x/api/v1/users/' + encodeURIComponent('..'))`
 * resolves to `/api/v1/`, popping a segment on the org's own host with the
 * caller's SSWS token still attached — on DELETE routes included.
 *
 * Assertions resolve through `new URL(...)` — the same normalization `fetch`
 * performs — and never string-match the template. A `startsWith(PREFIX)` check
 * alone stays green against exactly the one-popped-segment case above, so it is
 * always paired with a segment count and fixed-segment shape.
 */
import { describe, expect, it } from 'vitest'
import * as oktaTools from '@/tools/okta/index'
import type { ToolConfig } from '@/tools/types'

const DOMAIN = 'dev-123456.okta.com'
const SAFE_ID = 'SAFEID'

/** Values that must be rejected outright — encoding cannot neutralize them. */
const REJECTED_IDS = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..'] as const

/** Values encoding does neutralize — they must pass through, shape intact. */
const NEUTRALIZED_IDS = ['%2e%2e', '..%2f..', 'x?foo=attacker', 'a#frag'] as const

/**
 * Every attack vector, rejected or not. A vector is only safe if it either
 * throws or lands on the baseline's exact path shape — checking the prefix
 * alone is not enough, because `..` pops one segment and still starts with it.
 */
const ALL_VECTORS = [...REJECTED_IDS, ...NEUTRALIZED_IDS] as const

/** Values a real caller supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  '00u1a2b3c4d5e6f7g8h9',
  '00g1a2b3c4d5e6f7g8h9',
  'user@example.com',
  'example.com',
  'sub.example.co.uk',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

type AnyTool = ToolConfig<any, any>

function isOktaTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('okta_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

/** Fills every declared param, overriding the named ones with `overrides`. */
function buildParams(tool: AnyTool, fill: string, overrides: Record<string, string> = {}) {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    const type = (def as { type?: string }).type
    if (name === 'apiKey') params[name] = 'token'
    else if (name === 'domain') params[name] = DOMAIN
    else if (type === 'json' || type === 'array') params[name] = []
    else if (type === 'number') params[name] = 1
    else if (type === 'boolean') params[name] = false
    else params[name] = overrides[name] ?? fill
  }
  return params
}

function buildUrl(tool: AnyTool, fill: string, overrides: Record<string, string> = {}): URL {
  return new URL((tool.request!.url as (p: any) => string)(buildParams(tool, fill, overrides)))
}

const ALL_TOOLS = Object.values(oktaTools).filter(isOktaTool)

/** The declared string params whose value actually lands in the pathname. */
function pathParamsOf(tool: AnyTool): string[] {
  const names: string[] = []
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey' || name === 'domain') continue
    if ((def as { type?: string }).type !== 'string') continue
    try {
      if (buildUrl(tool, 'other', { [name]: SAFE_ID }).pathname.includes(SAFE_ID)) names.push(name)
    } catch {
      // A tool that cannot build with this shape has no path param to record
    }
  }
  return names
}

const PATH_TOOLS = ALL_TOOLS.map((tool) => ({
  name: tool.id,
  tool,
  pathParams: pathParamsOf(tool),
})).filter((entry) => entry.pathParams.length > 0)

const MULTI_PARAM_TOOLS = PATH_TOOLS.filter((entry) => entry.pathParams.length > 1)

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/** Asserts the built path has the baseline's exact shape outside the ID slots. */
function expectBaselineShape(actual: string[], baseline: string[]) {
  expect(actual).toHaveLength(baseline.length)
  expect(actual[1]).toBe('api')
  expect(actual[2]).toBe('v1')
  baseline.forEach((segment, index) => {
    if (segment === SAFE_ID) return
    expect(actual[index]).toBe(segment)
  })
}

describe('okta path-ID traversal safety', () => {
  it('covers every Okta tool that interpolates an ID into its path', () => {
    expect(PATH_TOOLS.length).toBeGreaterThanOrEqual(36)
  })

  it('finds Okta tools that interpolate more than one ID', () => {
    expect(MULTI_PARAM_TOOLS.length).toBeGreaterThanOrEqual(6)
  })

  describe.each(PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildUrl(tool, SAFE_ID))

    it('keeps its baseline under the Okta API prefix', () => {
      expect(buildUrl(tool, SAFE_ID).pathname.startsWith('/api/v1/')).toBe(true)
      expect(baseline.length).toBeGreaterThanOrEqual(4)
    })

    it.each(REJECTED_IDS)('rejects %j outright', (value) => {
      expect(() => buildUrl(tool, value)).toThrow()
    })

    it.each(NEUTRALIZED_IDS)('neutralizes %j without reshaping the path', (value) => {
      const url = buildUrl(tool, value)

      expectBaselineShape(segmentsOf(url), baseline)
      expect(url.origin).toBe(`https://${DOMAIN}`)
      expect(url.searchParams.get('foo')).toBeNull()
    })

    it.each(ALL_VECTORS)('either rejects %j or preserves the exact path shape', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expectBaselineShape(segmentsOf(url), baseline)
      expect(url.searchParams.get('foo')).toBeNull()
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment !== SAFE_ID) {
          expect(actual[index]).toBe(segment)
          return
        }
        expect(actual[index]).toBe(encodeURIComponent(value))
        expect(decodeURIComponent(actual[index])).toBe(value)
      })
    })
  })

  describe('guards every path param independently', () => {
    describe.each(MULTI_PARAM_TOOLS)('$name', ({ tool, pathParams }) => {
      const baseline = segmentsOf(buildUrl(tool, SAFE_ID))

      it.each(pathParams.flatMap((name) => REJECTED_IDS.map((v) => [name, v] as const)))(
        'rejects %s = %j while every other param stays safe',
        (name, value) => {
          expect(() => buildUrl(tool, SAFE_ID, { [name]: value })).toThrow()
        }
      )

      it.each(pathParams.flatMap((name) => ALL_VECTORS.map((v) => [name, v] as const)))(
        'either rejects %s = %j or preserves the shape, other params untouched',
        (name, value) => {
          let url: URL
          try {
            url = buildUrl(tool, SAFE_ID, { [name]: value })
          } catch {
            return
          }

          expectBaselineShape(segmentsOf(url), baseline)
          expect(url.searchParams.get('foo')).toBeNull()
        }
      )
    })
  })
})
