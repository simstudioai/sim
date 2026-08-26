/**
 * @vitest-environment node
 *
 * Guards every Attio tool that interpolates a parameter into its request path
 * against path traversal.
 *
 * Those parameters are `visibility: 'user-or-llm'`, so prompt injection
 * controls them. Interpolating one raw let a value like `..` pop a segment off
 * `/v2/objects/{objectType}/records/{recordId}` once `fetch` normalized the
 * URL, re-aiming the request — and the caller's Attio OAuth token — at a
 * different resource, including on DELETE routes.
 *
 * `encodeURIComponent` is NOT a fix: `.` and `..` are unreserved, so they
 * survive encoding untouched and the WHATWG parser then removes them as dot
 * segments. Only value rejection works. Every assertion below resolves the
 * built URL through `new URL(...)` — the same normalization `fetch` performs —
 * because string-matching the template is exactly what let this through.
 */
import { describe, expect, it } from 'vitest'
import * as attioTools from '@/tools/attio/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const ORIGIN = 'https://api.attio.com'
const API_PREFIX_SEGMENTS = ['', 'v2'] as const

/** Vectors the guard must reject outright; encoding cannot neutralize them. */
const REJECTED = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..'] as const

/**
 * Vectors `encodeURIComponent` genuinely does neutralize — `%` and `?` are
 * escaped, so the value stays one inert segment. These must NOT throw, and
 * they are the vectors that reach a *second* path parameter: a rejected value
 * throws at the first guard, masking an unguarded one further along.
 */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Values a real caller supplies; every one must survive byte-identical. */
const LEGITIMATE = ['people', '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9', '..foo', 'foo..'] as const

function isAttioTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('attio_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

function safeValueFor(name: string): string {
  return `SAFE${name}`
}

/**
 * Fills every declared param with a legitimate, per-param-unique value, then
 * overrides `target` with `value`. Non-string params get type-appropriate
 * stand-ins so the URL builder runs to completion.
 */
function buildParams(tool: AnyTool, target: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === target) {
      params[name] = value
      continue
    }
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') params[name] = []
    else if (type === 'number') params[name] = 1
    else if (type === 'boolean') params[name] = false
    else params[name] = safeValueFor(name)
  }
  return params
}

function buildUrl(tool: AnyTool, target: string, value: string): URL {
  return new URL((tool.request!.url as (p: any) => string)(buildParams(tool, target, value)))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

interface PathSite {
  name: string
  tool: AnyTool
  param: string
}

/**
 * Discovers path-zone parameters reflectively rather than by grep: a tool may
 * assign into a local variable before interpolating, which a grep for
 * `params.x` inside the template would miss.
 */
function collectPathSites(): PathSite[] {
  const sites: PathSite[] = []
  for (const tool of Object.values(attioTools)) {
    if (!isAttioTool(tool)) continue
    for (const [param, def] of Object.entries(tool.params ?? {})) {
      if ((def as { type?: string }).type !== 'string') continue
      const probe = 'ZQPROBEQZ'
      let url: URL
      try {
        url = buildUrl(tool, param, probe)
      } catch {
        continue
      }
      if (!url.pathname.includes(probe)) continue
      sites.push({ name: `${tool.id}.${param}`, tool, param })
    }
  }
  return sites
}

const PATH_SITES = collectPathSites()

describe('attio path-parameter traversal safety', () => {
  it('covers every Attio tool parameter that reaches the request path', () => {
    expect(PATH_SITES.length).toBeGreaterThanOrEqual(40)
  })

  describe.each(PATH_SITES)('$name', ({ tool, param }) => {
    const baseline = segmentsOf(buildUrl(tool, param, safeValueFor(param)))
    const marker = safeValueFor(param)

    it.each(REJECTED)('rejects %j instead of reshaping the path', (value) => {
      expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
    })

    it.each(NEUTRALIZED)('neutralizes %j into a single inert segment', (value) => {
      const url = buildUrl(tool, param, value)
      const actual = segmentsOf(url)

      expect(url.origin).toBe(ORIGIN)
      expect(actual.slice(0, API_PREFIX_SEGMENTS.length)).toEqual([...API_PREFIX_SEGMENTS])
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === marker) return
        expect(actual[index]).toBe(segment)
      })
      expect(url.searchParams.get('foo')).toBeNull()
    })

    it.each(LEGITIMATE)('passes %j through byte-identical', (value) => {
      const actual = segmentsOf(buildUrl(tool, param, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === marker ? value : segment)
      })
    })
  })
})

/**
 * The independence check. Poisoning *every* parameter at once passes even when
 * a second path parameter is unguarded, because the first guard throws before
 * the second is ever reached. Each case below poisons exactly one parameter
 * and leaves the rest legitimate.
 */
describe('guards every path param independently', () => {
  const MULTI_PARAM_TOOLS = PATH_SITES.reduce<Map<string, PathSite[]>>((acc, site) => {
    const key = site.tool.id
    acc.set(key, [...(acc.get(key) ?? []), site])
    return acc
  }, new Map())

  const MULTI = [...MULTI_PARAM_TOOLS.entries()]
    .filter(([, sites]) => sites.length > 1)
    .map(([id, sites]) => ({ id, sites }))

  it('finds multi-segment templates to check', () => {
    expect(MULTI.length).toBeGreaterThanOrEqual(10)
  })

  describe.each(MULTI)('$id', ({ sites }) => {
    it.each(sites.map((s) => s.param))('rejects a bare ".." in %s alone', (param) => {
      const site = sites.find((s) => s.param === param)!
      expect(() => buildUrl(site.tool, param, '..')).toThrow(new RegExp(param))
    })

    it.each(sites.map((s) => s.param))(
      'keeps the path shape when only %s carries an encoded vector',
      (param) => {
        const site = sites.find((s) => s.param === param)!
        const baseline = segmentsOf(buildUrl(site.tool, param, safeValueFor(param)))
        const actual = segmentsOf(buildUrl(site.tool, param, '..%2f..'))

        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          if (segment === safeValueFor(param)) return
          expect(actual[index]).toBe(segment)
        })
      }
    )
  })
})
