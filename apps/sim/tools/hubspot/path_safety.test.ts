/**
 * @vitest-environment node
 *
 * Guards every HubSpot tool against path traversal through an LLM-writable
 * identifier interpolated into the request path.
 *
 * Every path parameter reached here is `visibility: 'user-or-llm'`, so prompt
 * injection controls it. Interpolating one raw — or merely wrapping it in
 * `encodeURIComponent`, which is equally exploitable — let a value like `..`
 * pop a path segment once `fetch` normalized the URL, re-aiming the request and
 * the caller's credential at a sibling endpoint, DELETE routes included.
 *
 * Assertions resolve the built URL through `new URL(...)`, the same
 * normalization `fetch` performs, and compare *segment shape* rather than the
 * template text: `pathname.startsWith(prefix)` alone is too weak, because a
 * one-segment pop still satisfies the prefix.
 */
import { describe, expect, it } from 'vitest'
import * as toolModule from '@/tools/hubspot/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

/** Values that must be REJECTED outright — no encoding neutralizes them. */
const REJECTED = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..'] as const

/**
 * Values that must NOT throw but must also not reshape the path: the encoded
 * dot forms are inert once encoded, and the `?` cannot open a query string.
 */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Real values a caller legitimately supplies; none may be rejected or altered. */
const LEGITIMATE = ['12345678901', '0-1', 'contacts', 'p_custom_object', '..foo', 'foo..'] as const

const ID_PREFIX = 'SAFE'

/**
 * Distinct marker per parameter, so the segment a parameter occupies can be
 * located.
 *
 * A number-typed parameter gets a distinct *numeric* marker rather than a
 * shared constant. No HubSpot tool interpolates a number into its path today,
 * but a constant like `1` is indistinguishable between parameters, so one added
 * later would be invisible to {@link pathParamsOf} and silently uncovered.
 */
const NUMBER_MARKER_BASE = 900000001
const numberMarkers = new Map<string, number>()

function markerFor(name: string, type?: string): string {
  if (type !== 'number') return `${ID_PREFIX}${name}`
  if (!numberMarkers.has(name)) {
    numberMarkers.set(name, NUMBER_MARKER_BASE + numberMarkers.size)
  }
  return String(numberMarkers.get(name))
}

function isTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('hubspot_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

/**
 * Fills every declared parameter, giving each string parameter a distinct
 * placeholder so the segment a given parameter occupies can be located, and
 * overriding exactly one parameter with `value` when `poison` names it.
 */
function buildParams(tool: AnyTool, poison?: string, value?: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries<any>(tool.params ?? {})) {
    const type = def.type
    if (type === 'json' || type === 'object') params[name] = {}
    else if (type === 'array') params[name] = []
    else if (type === 'number') params[name] = Number(markerFor(name, type))
    else if (type === 'boolean') params[name] = false
    else params[name] = markerFor(name, type)
  }
  if (poison !== undefined) params[poison] = value
  return params
}

function buildUrl(tool: AnyTool, poison?: string, value?: string): URL {
  return new URL((tool.request?.url as (p: any) => string)(buildParams(tool, poison, value)))
}

/**
 * The parameters this tool interpolates into the PATH. Classification goes
 * through `new URL(...).pathname`, so query-zone and host-zone parameters are
 * excluded structurally rather than by comparing offsets in the raw template.
 */
function pathParamsOf(tool: AnyTool): string[] {
  const pathname = buildUrl(tool).pathname
  return Object.keys(tool.params ?? {}).filter((name) =>
    pathname.includes(markerFor(name, (tool.params as any)[name]?.type))
  )
}

const PATH_TOOLS = Object.values(toolModule)
  .filter(isTool)
  .map((tool) => ({ name: tool.id, tool, pathParams: pathParamsOf(tool) }))
  .filter((entry) => entry.pathParams.length > 0)

const TOTAL_PATH_PARAMS = PATH_TOOLS.reduce((sum, entry) => sum + entry.pathParams.length, 0)

describe('HubSpot path-parameter traversal safety', () => {
  it('covers every tool that interpolates a parameter into its path', () => {
    expect(PATH_TOOLS.length).toBe(31)
    expect(TOTAL_PATH_PARAMS).toBe(41)
  })

  describe.each(PATH_TOOLS)('$name', ({ tool, pathParams }) => {
    const baseline = buildUrl(tool)
    const baselineSegments = baseline.pathname.split('/')

    describe.each(pathParams)('guards every path param independently: %s', (param) => {
      const marker = markerFor(param, (tool.params as any)[param]?.type)
      /**
       * Located by substring, not by whole-segment equality. A parameter that
       * shares its segment with another (`/a/${x}-${y}/b`) is invisible to
       * `segments.indexOf(marker)` — that blind spot hid a real traversal in
       * the GitHub suite — so the marker is found *within* a segment and the
       * expected value is substituted in place.
       */
      const slot = baselineSegments.findIndex((segment) => segment.includes(marker))

      /** Substituting the marker in place is what makes a shared segment work. */
      const expectedSegment = (value: string) =>
        baselineSegments[slot].replace(marker, encodeURIComponent(value))

      it('occupies exactly one path segment in the baseline', () => {
        expect(slot).toBeGreaterThan(0)
        expect(baselineSegments.filter((segment) => segment.includes(marker))).toHaveLength(1)
      })

      it.each(REJECTED)('rejects %j', (value) => {
        expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
      })

      it.each(NEUTRALIZED)('neutralizes %j without reshaping the path', (value) => {
        const url = buildUrl(tool, param, value)
        const segments = url.pathname.split('/')

        expect(url.origin).toBe(baseline.origin)
        expect(segments).toHaveLength(baselineSegments.length)
        baselineSegments.forEach((segment, index) => {
          if (index === slot) return
          expect(segments[index]).toBe(segment)
        })
        expect(url.searchParams.get('foo')).toBeNull()
      })

      it.each(LEGITIMATE)('passes %j through byte-identical', (value) => {
        const url = buildUrl(tool, param, value)
        const segments = url.pathname.split('/')

        expect(url.origin).toBe(baseline.origin)
        expect(segments).toHaveLength(baselineSegments.length)
        baselineSegments.forEach((segment, index) => {
          expect(segments[index]).toBe(index === slot ? expectedSegment(value) : segment)
        })
      })
    })
  })
})
