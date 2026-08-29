/**
 * @vitest-environment node
 *
 * Guards every Cloudflare tool against path traversal through an LLM-writable
 * ID that gets interpolated into the request path.
 *
 * Zone, account, ruleset, rule, record, tunnel, and bucket IDs are
 * `visibility: 'user-or-llm'`, so prompt injection controls them. Interpolating
 * one raw let a value like `../../accounts/victim` escape its `/client/v4`
 * prefix once `fetch` normalized the URL, re-aiming the request — and the
 * user's Cloudflare API token — at an arbitrary Cloudflare resource, including
 * on the DELETE zone and DELETE bucket routes.
 *
 * `encodeURIComponent` is NOT enough, which is why the vector list below keeps
 * the bare `.` and `..` segments: both are made of unreserved characters, so
 * they survive encoding untouched and the URL parser then removes them as dot
 * segments, popping one path segment off a fixed host. Every assertion here
 * resolves the built URL with `new URL(...)` — the same normalization `fetch`
 * performs — rather than string-matching the template output, because string
 * matching is exactly what let this through.
 *
 * The tool list is enumerated from the barrel, so a newly added Cloudflare tool
 * that interpolates an unguarded ID fails here without anyone editing this file.
 */
import { describe, expect, it } from 'vitest'
import * as cloudflareTools from '@/tools/cloudflare'
import type { ToolConfig } from '@/tools/types'

const API_ORIGIN = 'https://api.cloudflare.com'
const API_PREFIX = '/client/v4/'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../accounts/victim-account',
  '..%2f..%2faccounts/victim-account',
  '023e105f4ecef8ad9ca31a8372d0c353/../../accounts/victim-account',
  '023e105f4ecef8ad9ca31a8372d0c353?account_id=attacker',
  '023e105f4ecef8ad9ca31a8372d0c353#fragment',
  '023e105f4ecef8ad9ca31a8372d0c353/dns_records/../../../zones',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  '023e105f4ecef8ad9ca31a8372d0c353',
  'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  'http_request_firewall_custom',
  'always_use_https',
  'my-bucket',
  'my.bucket.name',
  'worker-script-v2',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isCloudflareTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('cloudflare_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'cf-token' }
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

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(cloudflareTools)
  .filter(isCloudflareTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildUrl(tool, SAFE_ID).pathname.includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('cloudflare path-ID traversal safety', () => {
  it('covers every Cloudflare tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(40)
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

      expect(url.origin).toBe(API_ORIGIN)
      expect(url.pathname.startsWith(API_PREFIX)).toBe(true)

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(TRAVERSAL_IDS)('never smuggles a query parameter via %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.searchParams.get('account_id')).toBeNull()
    })

    it('rejects a bare dot-dot segment instead of silently popping the prefix', () => {
      expect(() => buildUrl(tool, '..')).toThrow(/path traversal is not allowed/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow(/path traversal is not allowed/)
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? value : segment)
      })
    })

    it('trims surrounding whitespace off a legitimate ID', () => {
      const actual = segmentsOf(buildUrl(tool, '  023e105f4ecef8ad9ca31a8372d0c353  ').pathname)

      baseline.forEach((segment, index) => {
        if (segment !== SAFE_ID) return
        expect(actual[index]).toBe('023e105f4ecef8ad9ca31a8372d0c353')
      })
    })
  })
})
