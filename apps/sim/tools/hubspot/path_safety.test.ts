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
    else if (type === 'number') params[name] = 1
    else if (type === 'boolean') params[name] = false
    else params[name] = name === poison ? value : `${ID_PREFIX}${name}`
  }
  return params
}

function buildUrl(tool: AnyTool, poison?: string, value?: string): URL {
  return new URL((tool.request?.url as (p: any) => string)(buildParams(tool, poison, value)))
}

/** The parameters this tool interpolates into the path (not the query string). */
function pathParamsOf(tool: AnyTool): string[] {
  const raw = (tool.request?.url as (p: any) => string)(buildParams(tool))
  const queryStart = raw.indexOf('?')
  return Object.keys(tool.params ?? {}).filter((name) => {
    const at = raw.indexOf(`${ID_PREFIX}${name}`)
    return at !== -1 && (queryStart === -1 || at < queryStart)
  })
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
      const slot = baselineSegments.indexOf(`${ID_PREFIX}${param}`)

      it('occupies exactly one path segment in the baseline', () => {
        expect(slot).toBeGreaterThan(0)
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

      it.each(LEGITIMATE)('passes %j through unchanged', (value) => {
        const url = buildUrl(tool, param, value)
        const segments = url.pathname.split('/')

        expect(url.origin).toBe(baseline.origin)
        expect(segments).toHaveLength(baselineSegments.length)
        baselineSegments.forEach((segment, index) => {
          expect(index === slot ? decodeURIComponent(segments[index]) : segments[index]).toBe(
            index === slot ? value : segment
          )
        })
      })
    })
  })
})
