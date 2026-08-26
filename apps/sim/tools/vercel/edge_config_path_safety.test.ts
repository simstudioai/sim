/**
 * @vitest-environment node
 *
 * Guards every Vercel tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * These IDs are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../v9/projects/x` escape its API
 * prefix once `fetch` normalized the URL, re-aiming the request (and the user's
 * Vercel bearer token) at an arbitrary Vercel resource — including on DELETE.
 * `assertRequestUrlMatchesTrust` in `tools/request-transport.ts` only applies
 * its canonicalization guard to internal `/api/` routes, so nothing downstream
 * catches this.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 */
import { describe, expect, it } from 'vitest'
import type { ToolConfig } from '@/tools/types'
import { vercelDeleteEdgeConfigTool } from '@/tools/vercel/delete_edge_config'
import { vercelGetEdgeConfigTool } from '@/tools/vercel/get_edge_config'
import { vercelGetEdgeConfigItemsTool } from '@/tools/vercel/get_edge_config_items'
import * as vercelTools from '@/tools/vercel/index'
import { vercelUpdateEdgeConfigItemsTool } from '@/tools/vercel/update_edge_config_items'

const BASE_PATH = '/v1/global-config/'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * earlier `encodeURIComponent`-only fix looked correct while the hole was live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../v9/projects/prod-site',
  '..%2f..%2fv9/projects/prod-site',
  'ecfg_abc/../../../v9/projects/prod-site',
  'ecfg_abc?teamId=attacker',
  'ecfg_abc#fragment',
  'ecfg_abc/items/../../../v2/domains',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  'ecfg_abc123',
  'flags',
  'feature-flags',
  'prj_2W7QpN8xkE4hVvRt6bLd',
  'dpl_9aBcDeFgHiJkLmNoPqRsTuVwXyZ',
  'example.com',
  'sub.example.co.uk',
  'my-app.vercel.app',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isVercelTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('vercel_')
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

function buildPath(tool: AnyTool, value: string): string {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, value) as any)).pathname
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(vercelTools)
  .filter(isVercelTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildPath(tool, SAFE_ID).includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('vercel path-ID traversal safety', () => {
  it('covers every Vercel tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(20)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildPath(tool, SAFE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let path: string
      try {
        path = buildPath(tool, value)
      } catch {
        return
      }

      const actual = segmentsOf(path)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildPath(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? value : segment)
      })
    })
  })
})

const EDGE_CONFIG_TOOLS: ReadonlyArray<{ name: string; tool: AnyTool }> = [
  { name: 'vercel_get_edge_config', tool: vercelGetEdgeConfigTool },
  { name: 'vercel_delete_edge_config', tool: vercelDeleteEdgeConfigTool },
  { name: 'vercel_get_edge_config_items', tool: vercelGetEdgeConfigItemsTool },
  { name: 'vercel_update_edge_config_items', tool: vercelUpdateEdgeConfigItemsTool },
]

function buildEdgeConfigUrl(tool: AnyTool, edgeConfigId: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url({ apiKey: 'token', edgeConfigId, items: [] }))
}

describe.each(EDGE_CONFIG_TOOLS)('$name edgeConfigId path safety', ({ tool }) => {
  it.each(TRAVERSAL_IDS)('keeps %j inside /v1/global-config/', (edgeConfigId) => {
    let url: URL
    try {
      url = buildEdgeConfigUrl(tool, edgeConfigId)
    } catch {
      return
    }

    expect(url.origin).toBe('https://api.vercel.com')
    expect(url.pathname.startsWith(BASE_PATH)).toBe(true)
    expect(url.pathname).not.toContain('/v9/')
    expect(url.pathname).not.toContain('/v2/')
  })

  it('rejects a bare dot-dot segment instead of silently popping the prefix', () => {
    expect(() => buildEdgeConfigUrl(tool, '..')).toThrow(/edgeConfigId/)
  })

  it('rejects a bare dot segment', () => {
    expect(() => buildEdgeConfigUrl(tool, '.')).toThrow(/edgeConfigId/)
  })

  it('does not let the id inject query parameters', () => {
    const url = buildEdgeConfigUrl(tool, 'ecfg_abc?teamId=attacker')

    expect(url.searchParams.get('teamId')).toBeNull()
  })

  it('preserves a legitimate store id verbatim', () => {
    const url = buildEdgeConfigUrl(tool, '  ecfg_abc123  ')

    expect(url.pathname.startsWith(`${BASE_PATH}ecfg_abc123`)).toBe(true)
  })

  it('preserves a legitimate slug verbatim', () => {
    const url = buildEdgeConfigUrl(tool, 'feature-flags')

    expect(url.pathname.startsWith(`${BASE_PATH}feature-flags`)).toBe(true)
  })
})
