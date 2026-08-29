/**
 * @vitest-environment node
 *
 * Guards every HubSpot tool against path traversal through an LLM-writable id
 * that gets interpolated into the request path.
 *
 * These ids (record ids, list ids, object types) are `visibility: 'user-or-llm'`,
 * so prompt injection controls them. Interpolating one raw let a value like
 * `../../v3/objects/contacts/1` escape the object it addresses once `fetch`
 * normalized the URL, re-aiming the request — with the user's HubSpot token
 * still attached — at an arbitrary CRM record, including on the DELETE tools.
 *
 * Wrapping the id in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 */
import { describe, expect, it } from 'vitest'
import { hubspotDeleteAssociationTool } from '@/tools/hubspot/delete_association'
import { hubspotDeleteCompanyTool } from '@/tools/hubspot/delete_company'
import { hubspotDeleteContactTool } from '@/tools/hubspot/delete_contact'
import { hubspotDeleteDealTool } from '@/tools/hubspot/delete_deal'
import * as hubspotTools from '@/tools/hubspot/index'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../v3/objects/contacts/1',
  '..%2f..%2fv3/objects/contacts/1',
  '12345/../../../v3/objects/deals',
  '12345?properties=email',
  '12345#fragment',
  '12345/associations/../../../v4/objects',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  '12345',
  '9876543210',
  '0-1',
  'contacts',
  'companies',
  'line_items',
  'marketing_events',
  'p12345678_my_custom_object',
  'email',
  'hs_object_id',
] as const

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isHubSpotTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('hubspot_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
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

function buildUrl(tool: AnyTool, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, value) as any))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(hubspotTools)
  .filter(isHubSpotTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildUrl(tool, SAFE_ID).pathname.includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('hubspot path-id traversal safety', () => {
  it('covers every HubSpot tool that interpolates an id into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(28)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildUrl(tool, SAFE_ID).pathname)

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.hubapi.com')

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? value : segment)
      })
    })
  })
})

const HIGH_RISK_TOOLS: ReadonlyArray<{ name: string; tool: AnyTool }> = [
  { name: 'hubspot_delete_contact', tool: hubspotDeleteContactTool },
  { name: 'hubspot_delete_company', tool: hubspotDeleteCompanyTool },
  { name: 'hubspot_delete_deal', tool: hubspotDeleteDealTool },
  { name: 'hubspot_delete_association', tool: hubspotDeleteAssociationTool },
]

describe.each(HIGH_RISK_TOOLS)('$name id path safety', ({ tool }) => {
  it('rejects a bare dot-dot segment instead of silently popping the resource', () => {
    expect(() => buildUrl(tool, '..')).toThrow(/path traversal/)
  })

  it('rejects a bare dot segment', () => {
    expect(() => buildUrl(tool, '.')).toThrow(/path traversal/)
  })

  it('does not let the id inject query parameters', () => {
    const url = buildUrl(tool, '12345?properties=email')

    expect(url.searchParams.get('properties')).toBeNull()
  })

  it('preserves a legitimate numeric id verbatim after trimming', () => {
    expect(buildUrl(tool, '  12345  ').pathname).toContain('/12345')
  })
})
