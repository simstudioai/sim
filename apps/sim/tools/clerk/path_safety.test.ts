/**
 * @vitest-environment node
 *
 * Guards every Clerk tool against path traversal through an LLM-writable
 * identifier that gets interpolated into the request path.
 *
 * These identifiers are `visibility: 'user-or-llm'`, so prompt injection
 * controls them. Interpolating one raw let a value like `../../v1/organizations/prod`
 * escape its API prefix once `fetch` normalized the URL, re-aiming the request
 * — and the user's Clerk credential — at a sibling endpoint, including on
 * DELETE.
 *
 * `encodeURIComponent` is NOT a fix: `.` and `..` are unreserved, so they
 * survive encoding verbatim, and the WHATWG parser removes dot segments
 * *after* percent-decoding. Only rejecting the value works, which is what
 * `safeUrlPathSegment` does.
 *
 * Every assertion resolves the built URL through `new URL(...)` — the same
 * normalization `fetch` performs — and checks the segment COUNT and the fixed
 * segments, never a `startsWith` on the prefix: `/v1/x/..` still
 * starts with `/v1/`, so a prefix check passes while the hole is live.
 */
import { describe, expect, it } from 'vitest'
import * as serviceTools from '@/tools/clerk/index'
import type { ToolConfig } from '@/tools/types'

const ORIGIN = 'https://api.clerk.com'
const ID_PREFIX = 'clerk_'
const MIN_PATH_TOOLS = 23

/** Segments that must never move, whatever the caller supplies. */
const FIXED_SEGMENTS: ReadonlyArray<readonly [number, string]> = [[1, 'v1']]

/**
 * Values that must be REJECTED outright. Encoding cannot neutralize a bare dot
 * segment, and a separator means the caller addressed something other than the
 * single segment the parameter names.
 */
const REJECTED_VALUES = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..'] as const

/**
 * Values that are NEUTRALIZED rather than rejected: `encodeURIComponent`
 * escapes the `%` and the `?`, so each becomes a literal, inert segment name.
 */
const NEUTRALIZED_VALUES = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Real identifiers; every one must survive byte-identical. */
const LEGITIMATE_VALUES = [
  'user_2abc',
  'cus_NffrFeUfNV2Hib',
  '9f8b1c2d-3e4a-4b5c-8d7e-6f0a1b2c3d4e',
  '023e105f4ecef8ad9ca31a8372d0c353',
  'example.com',
  '..foo',
  'foo..',
] as const

type AnyTool = ToolConfig<any, any>

function isServiceTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith(ID_PREFIX) &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

function sentinelFor(index: number): string {
  return `SENTINEL${index}X`
}

/**
 * Fills every declared param, giving each string param its own sentinel so the
 * one that reaches the path can be identified without reading the template.
 */
function baseParams(tool: AnyTool): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  Object.keys(tool.params ?? {}).forEach((name, index) => {
    const type = (tool.params[name] as { type?: string }).type
    if (type === 'json' || type === 'array') params[name] = []
    else if (type === 'boolean') params[name] = false
    else if (type === 'number') params[name] = 1
    else params[name] = sentinelFor(index)
  })
  return params
}

function buildUrl(tool: AnyTool, overrides: Record<string, unknown> = {}): URL {
  return new URL((tool.request!.url as (p: any) => string)({ ...baseParams(tool), ...overrides }))
}

interface PathParam {
  name: string
  sentinel: string
}

/** Reflectively finds the params whose value lands in the path, not the query. */
function pathParamsOf(tool: AnyTool): PathParam[] {
  let pathname: string
  try {
    pathname = buildUrl(tool).pathname
  } catch {
    return []
  }
  const found: PathParam[] = []
  Object.keys(tool.params ?? {}).forEach((name, index) => {
    const sentinel = sentinelFor(index)
    if (baseParams(tool)[name] === sentinel && pathname.includes(sentinel)) {
      found.push({ name, sentinel })
    }
  })
  return found
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

const PATH_TOOLS = Array.from(
  new Map(
    Object.values(serviceTools)
      .filter(isServiceTool)
      .map((tool) => [tool.id, tool] as const)
  ).values()
)
  .map((tool) => ({ name: tool.id, tool, pathParams: pathParamsOf(tool) }))
  .filter((entry) => entry.pathParams.length > 0)

const MULTI_PARAM_TOOLS = PATH_TOOLS.filter((entry) => entry.pathParams.length > 1)

describe('Clerk path-parameter traversal safety', () => {
  it('covers every Clerk tool that interpolates a param into its path', () => {
    expect(PATH_TOOLS.length).toBeGreaterThanOrEqual(MIN_PATH_TOOLS)
  })

  it('has multi-parameter paths, so the independence block is meaningful', () => {
    expect(MULTI_PARAM_TOOLS.length).toBeGreaterThan(0)
  })

  describe.each(PATH_TOOLS)('$name', ({ tool, pathParams }) => {
    const baseline = segmentsOf(buildUrl(tool))

    function expectShapePreserved(actual: string[], poisoned: PathParam): void {
      expect(actual).toHaveLength(baseline.length)
      for (const [index, value] of FIXED_SEGMENTS) {
        expect(actual[index]).toBe(value)
      }
      baseline.forEach((segment, index) => {
        if (segment.includes(poisoned.sentinel)) return
        expect(actual[index]).toBe(segment)
      })
    }

    /**
     * Poisons ONE param at a time, leaving the rest legitimate. Poisoning all
     * of them at once would let the first guard throw before an unguarded
     * second param is ever reached, hiding the hole.
     */
    describe('guards every path param independently', () => {
      it.each(pathParams)('$name rejects a bare dot-dot segment', (param) => {
        expect(() => buildUrl(tool, { [param.name]: '..' })).toThrow(new RegExp(param.name))
      })

      it.each(pathParams)('$name rejects a bare dot segment', (param) => {
        expect(() => buildUrl(tool, { [param.name]: '.' })).toThrow(new RegExp(param.name))
      })

      it.each(pathParams)('$name rejects an embedded separator', (param) => {
        expect(() => buildUrl(tool, { [param.name]: 'a/../../b' })).toThrow(new RegExp(param.name))
      })
    })

    describe.each(pathParams)('$name', (param) => {
      it.each(REJECTED_VALUES)('rejects %j', (value) => {
        expect(() => buildUrl(tool, { [param.name]: value })).toThrow()
      })

      it.each(NEUTRALIZED_VALUES)('neutralizes %j without reshaping the path', (value) => {
        const url = buildUrl(tool, { [param.name]: value })

        expect(url.origin).toBe(ORIGIN)
        expectShapePreserved(segmentsOf(url), param)
        expect(url.searchParams.get('foo')).toBeNull()
      })

      it.each(LEGITIMATE_VALUES)('passes %j through byte-identical', (value) => {
        const url = buildUrl(tool, { [param.name]: value })
        const actual = segmentsOf(url)

        expect(url.origin).toBe(ORIGIN)
        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment.replace(param.sentinel, value))
        })
      })

      it('trims a padded identifier instead of rejecting it', () => {
        const url = buildUrl(tool, { [param.name]: '  abc123  ' })
        const actual = segmentsOf(url)

        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment.replace(param.sentinel, 'abc123'))
        })
      })
    })
  })
})
