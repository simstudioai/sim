/**
 * @vitest-environment node
 *
 * Guards the Edge Config tools against path traversal through `edgeConfigId`.
 *
 * `edgeConfigId` is `visibility: 'user-or-llm'`, so prompt injection controls it.
 * Interpolating it raw let a value like `../../v9/projects/x` escape the
 * `/v1/global-config/` prefix once `fetch` normalized the URL, re-aiming the
 * request (and the user's Vercel bearer token) at an arbitrary Vercel resource.
 * `assertRequestUrlMatchesTrust` in `tools/request-transport.ts` only applies its
 * canonicalization guard to internal `/api/` routes, so nothing downstream
 * catches this. These tests resolve the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — so a regression goes red.
 */
import { describe, expect, it } from 'vitest'
import type { ToolConfig } from '@/tools/types'
import { vercelDeleteEdgeConfigTool } from '@/tools/vercel/delete_edge_config'
import { vercelGetEdgeConfigTool } from '@/tools/vercel/get_edge_config'
import { vercelGetEdgeConfigItemsTool } from '@/tools/vercel/get_edge_config_items'
import { vercelUpdateEdgeConfigItemsTool } from '@/tools/vercel/update_edge_config_items'

const BASE_PATH = '/v1/global-config/'

const TRAVERSAL_IDS = [
  '../../v9/projects/prod-site',
  '..%2f..%2fv9/projects/prod-site',
  'ecfg_abc/../../../v9/projects/prod-site',
  'ecfg_abc?teamId=attacker',
  'ecfg_abc#fragment',
  'ecfg_abc/items/../../../v2/domains',
] as const

const EDGE_CONFIG_TOOLS: ReadonlyArray<{
  name: string
  tool: ToolConfig<any, any>
}> = [
  { name: 'vercel_get_edge_config', tool: vercelGetEdgeConfigTool },
  { name: 'vercel_delete_edge_config', tool: vercelDeleteEdgeConfigTool },
  { name: 'vercel_get_edge_config_items', tool: vercelGetEdgeConfigItemsTool },
  { name: 'vercel_update_edge_config_items', tool: vercelUpdateEdgeConfigItemsTool },
]

function buildUrl(tool: ToolConfig<any, any>, edgeConfigId: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url({ apiKey: 'token', edgeConfigId, items: [] }))
}

describe.each(EDGE_CONFIG_TOOLS)('$name edgeConfigId path safety', ({ tool }) => {
  it.each(TRAVERSAL_IDS)('keeps %j inside /v1/global-config/', (edgeConfigId) => {
    const url = buildUrl(tool, edgeConfigId)

    expect(url.origin).toBe('https://api.vercel.com')
    expect(url.pathname.startsWith(BASE_PATH)).toBe(true)
    expect(url.pathname).not.toContain('/v9/')
    expect(url.pathname).not.toContain('/v2/')
  })

  it('does not let the id inject query parameters', () => {
    const url = buildUrl(tool, 'ecfg_abc?teamId=attacker')

    expect(url.searchParams.get('teamId')).toBeNull()
  })

  it('preserves a legitimate store id verbatim', () => {
    const url = buildUrl(tool, '  ecfg_abc123  ')

    expect(url.pathname.startsWith(`${BASE_PATH}ecfg_abc123`)).toBe(true)
  })

  it('preserves a legitimate slug verbatim', () => {
    const url = buildUrl(tool, 'feature-flags')

    expect(url.pathname.startsWith(`${BASE_PATH}feature-flags`)).toBe(true)
  })
})
