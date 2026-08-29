/**
 * @vitest-environment node
 *
 * Guards every incident.io tool against path traversal through an LLM-writable
 * ID that gets interpolated into the request path.
 *
 * These IDs are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../v2/incidents/victim` escape its
 * API prefix once `fetch` normalized the URL, re-aiming the request (and the
 * user's incident.io bearer token) at an arbitrary incident.io resource —
 * including on the DELETE routes for schedules, workflows, custom fields, and
 * incident roles. `assertRequestUrlMatchesTrust` in `tools/request-transport.ts`
 * only applies its canonicalization guard to internal `/api/` routes, so
 * nothing downstream catches this.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * Tools are enumerated from the barrel rather than listed by hand, so a newly
 * added tool that interpolates an unguarded ID fails this suite on arrival.
 */
import { describe, expect, it } from 'vitest'
import * as incidentioTools from '@/tools/incidentio/index'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../v2/incidents/01FCNDV6P870EA6S7TK1DSYDG0',
  '..%2f..%2fv2/incidents/01FCNDV6P870EA6S7TK1DSYDG0',
  '01FCNDV6P870EA6S7TK1DSYDG0/../../../v2/schedules',
  '01FCNDV6P870EA6S7TK1DSYDG0?page_size=100',
  '01FCNDV6P870EA6S7TK1DSYDG0#fragment',
  '01FCNDV6P870EA6S7TK1DSYDG0/actions/../../../v3/catalog_types',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  '01FCNDV6P870EA6S7TK1DSYDG0',
  '01HB5T3XK9WZ8Q2N4MJ7VYRPD6',
  '01G0M0KFHXQXCEE1DVZ7YXQY5T',
  'ABC123',
  'incident-role-primary',
  'my_custom_field',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isIncidentioTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('incidentio_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
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

function buildUrl(tool: AnyTool, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, value) as any))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(incidentioTools)
  .filter(isIncidentioTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildUrl(tool, SAFE_ID).pathname.includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('incident.io path-ID traversal safety', () => {
  it('covers every incident.io tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(28)
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

      expect(url.origin).toBe('https://api.incident.io')

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
        expect(actual[index]).toBe(segment === SAFE_ID ? value : segment)
      })
    })

    it('rejects a bare dot-dot segment instead of silently popping the prefix', () => {
      expect(() => buildUrl(tool, '..')).toThrow()
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow()
    })

    it('trims surrounding whitespace without altering the id', () => {
      const padded = segmentsOf(buildUrl(tool, '  01FCNDV6P870EA6S7TK1DSYDG0  '))

      baseline.forEach((segment, index) => {
        expect(padded[index]).toBe(segment === SAFE_ID ? '01FCNDV6P870EA6S7TK1DSYDG0' : segment)
      })
    })

    it('does not let the id inject query parameters', () => {
      const url = buildUrl(tool, '01FCNDV6P870EA6S7TK1DSYDG0?page_size=100')

      expect(url.searchParams.get('page_size')).not.toBe('100')
    })
  })
})
