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
 * The suite enumerates **(tool, param) pairs** and fuzzes one param at a time,
 * holding every sibling at a safe value. Fuzzing all params at once cannot work
 * here: the first guard to throw aborts URL construction, so a tool's remaining
 * params stop being exercised the moment one of them is fixed. Pair enumeration
 * is what makes "a newly unguarded param fails CI" actually true for a tool that
 * already has a guarded param — the dominant shape in this service, where
 * `accountId` + `appId` + `policyId` and `zoneId` + `rulesetId` + `ruleId`
 * share one path.
 */
import { describe, expect, it } from 'vitest'
import * as cloudflareTools from '@/tools/cloudflare'
import type { ToolConfig } from '@/tools/types'

const API_ORIGIN = 'https://api.cloudflare.com'
const API_PREFIX = '/client/v4/'
const CREDENTIAL_PARAM = 'apiKey'

/**
 * Vectors the guard must **reject outright**. Each is either a bare dot segment
 * or carries a path separator, so encoding it would leave a live traversal.
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const MUST_REJECT = [
  '..',
  '.',
  '  ..  ',
  '../../accounts/victim-account',
  '..%2f..%2faccounts/victim-account',
  '023e105f4ecef8ad9ca31a8372d0c353/../../accounts/victim-account',
  '023e105f4ecef8ad9ca31a8372d0c353/dns_records/../../../zones',
  '\\..\\..',
] as const

/**
 * Vectors that are not traversals but must not be able to reshape the request:
 * a `?` or `#` inside a segment has to stay inside that segment.
 */
const MUST_NEUTRALIZE = [
  '023e105f4ecef8ad9ca31a8372d0c353?account_id=attacker',
  '023e105f4ecef8ad9ca31a8372d0c353#frag',
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
const PROBE = 'PROBEVALUE'
const TRIM_SAMPLE = '023e105f4ecef8ad9ca31a8372d0c353'

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
 * Builds a param object with every string param at a known-safe value, then
 * applies one override so exactly one param carries the value under test.
 */
function buildParams(
  tool: AnyTool,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const params: Record<string, unknown> = { [CREDENTIAL_PARAM]: 'cf-token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === CREDENTIAL_PARAM) continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array' || type === 'file[]') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SAFE_ID
    }
  }
  return { ...params, ...overrides }
}

function buildUrl(tool: AnyTool, overrides: Record<string, unknown> = {}): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, overrides) as any))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const TOOLS = Object.values(cloudflareTools)
  .filter(isCloudflareTool)
  .filter((tool) => typeof tool.request?.url === 'function')

/**
 * Every (tool, param) pair where that param alone reaches the request path,
 * discovered by probing one param at a time. A newly added tool — or a newly
 * added path param on an existing tool — appears here with no edit to this file.
 */
const PATH_PARAM_PAIRS = TOOLS.flatMap((tool) =>
  Object.keys(tool.params ?? {})
    .filter((param) => param !== CREDENTIAL_PARAM)
    .filter((param) => {
      try {
        return buildUrl(tool, { [param]: PROBE }).pathname.includes(PROBE)
      } catch {
        return false
      }
    })
    .map((param) => ({ name: `${tool.id} / ${param}`, tool, param }))
)

describe('cloudflare path-param traversal safety', () => {
  it('finds every (tool, param) pair that reaches the request path', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(65)
  })

  it('covers multi-param paths, where whole-object fuzzing goes blind', () => {
    const counts = new Map<string, number>()
    for (const { tool } of PATH_PARAM_PAIRS) {
      counts.set(tool.id, (counts.get(tool.id) ?? 0) + 1)
    }
    const multiParamTools = [...counts.values()].filter((count) => count > 1)

    expect(multiParamTools.length).toBeGreaterThanOrEqual(15)
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, param }) => {
    const baseline = segmentsOf(buildUrl(tool, { [param]: PROBE }).pathname)

    it.each(MUST_REJECT)('rejects %j outright', (value) => {
      expect(() => buildUrl(tool, { [param]: value })).toThrow(
        new RegExp(`${param}|path traversal|path separator`)
      )
    })

    it.each(MUST_NEUTRALIZE)('confines %j to a single segment', (value) => {
      const url = buildUrl(tool, { [param]: value })

      expect(url.origin).toBe(API_ORIGIN)
      expect(url.pathname.startsWith(API_PREFIX)).toBe(true)
      expect(url.searchParams.get('account_id')).toBeNull()
      expect(url.hash).toBe('')

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(PROBE)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, { [param]: value }).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(PROBE, value))
      })
    })

    it('trims surrounding whitespace off a legitimate value', () => {
      const actual = segmentsOf(buildUrl(tool, { [param]: `  ${TRIM_SAMPLE}  ` }).pathname)

      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(PROBE, TRIM_SAMPLE))
      })
    })
  })
})
