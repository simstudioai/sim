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
 * `encodeURIComponent` is NOT enough: `.` and `..` are unreserved, so they
 * survive encoding untouched and the URL parser then removes them as dot
 * segments. Every assertion here resolves the built URL with `new URL(...)` —
 * the same normalization `fetch` performs — rather than string-matching the
 * template output, because string matching is what let this through.
 *
 * Two independent blind spots shape this file, and both are load-bearing:
 *
 * 1. **Fuzz one param at a time.** URL construction is eager, so filling every
 *    param with the same vector means the first guard to throw aborts the whole
 *    case and every sibling goes untested — once a tool has one guard, a newly
 *    unguarded sibling can no longer fail CI. So the suite enumerates
 *    (tool, param) pairs and holds every sibling at a safe value.
 * 2. **Assert rejection, not just shape.** A bare `.` in the FINAL segment
 *    collapses invisibly: `/zones/abc/rulesets/.` normalizes to
 *    `/zones/abc/rulesets/`, which keeps the segment count and every other
 *    segment intact, so a shape-only check passes with the guard removed. Since
 *    the guarded id is the last segment on `delete_zone`, `delete_r2_bucket`,
 *    `delete_ruleset_rule` and friends — all DELETEs — that is exactly where a
 *    shape check is blindest. `MUST_REJECT` therefore asserts a throw.
 */
import { describe, expect, it } from 'vitest'
import * as cloudflareTools from '@/tools/cloudflare'
import { deleteZoneTool } from '@/tools/cloudflare/delete_zone'

const API_ORIGIN = 'https://api.cloudflare.com'
const API_PREFIX = '/client/v4/'
const CREDENTIAL_PARAM = 'apiKey'

/**
 * Vectors the guard must **reject outright**. Each is a bare dot segment or
 * carries a path separator, so encoding it would leave a live traversal.
 */
const MUST_REJECT = [
  '..',
  '.',
  '  ..  ',
  '  .  ',
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

/**
 * Tools that legitimately build no URL from params, so the pair enumeration
 * cannot reach them: `create_zone` posts to a static collection URL, and
 * `get_zone_settings` fans out through an internal operation (its own
 * `zoneSettingUrl` already rejects dot segments, asserted in cloudflare.test.ts).
 * Named explicitly rather than silently skipped: a tool that loses its URL
 * builder must surface here rather than quietly dropping out of coverage.
 */
const TOOLS_WITHOUT_PARAM_BUILT_URLS = [
  'cloudflare_create_zone',
  'cloudflare_get_zone_settings',
] as const

/**
 * (tool, param) pairs that deliberately REJECT surrounding whitespace rather
 * than trimming it. Only `delete_r2_bucket` qualifies: it is the sole parameter
 * that is both newly trimmed by this PR and attached to an irreversible
 * request, so inferring the caller's intent there is not worth the risk.
 * Listing it here keeps the divergence explicit rather than implicit.
 */
const REJECTS_SURROUNDING_WHITESPACE = new Set(['cloudflare_delete_r2_bucket/bucketName'])

const SAFE_ID = 'SAFEID'
const PROBE = 'PROBEVALUE'
const TRIM_SAMPLE = '023e105f4ecef8ad9ca31a8372d0c353'

interface PathToolParam {
  type?: string
  required?: boolean
}

/** The structural slice of a tool config this suite needs; avoids `any`. */
interface ServiceTool {
  id: string
  params?: Record<string, PathToolParam>
  request?: { url?: unknown; body?: unknown; headers?: unknown }
}

/** A tool that builds its request URL from params, so it can be probed. */
type PathTool = ServiceTool & {
  request: {
    url: (params: Record<string, unknown>) => string
    body?: (params: Record<string, unknown>) => unknown
    headers?: (params: Record<string, unknown>) => unknown
  }
}

function isCloudflareTool(value: unknown): value is ServiceTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ServiceTool).id === 'string' &&
    (value as ServiceTool).id.startsWith('cloudflare_')
  )
}

/**
 * Whether calling `fn` raises a `TypeError` — the signature of a builder that
 * assumed a param was a string (`params.x?.trim is not a function`). Domain
 * errors thrown deliberately by a builder are not TypeErrors, so they pass
 * through and do not cause a false failure here.
 */
function throwsTypeError(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch (error) {
    return error instanceof TypeError
  }
}

function isPathTool(tool: ServiceTool): tool is PathTool {
  return typeof tool.request?.url === 'function'
}

function pathToolFor(value: unknown, id: string): PathTool {
  if (!isCloudflareTool(value) || !isPathTool(value)) {
    throw new Error(`${id} does not build its URL from params`)
  }
  return value
}

/**
 * Builds a param object with every string param at a known-safe value, then
 * applies one override so exactly one param carries the value under test.
 */
function buildParams(tool: PathTool, overrides: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = { [CREDENTIAL_PARAM]: 'cf-token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === CREDENTIAL_PARAM) continue
    if (def.type === 'json' || def.type === 'array' || def.type === 'file[]') {
      params[name] = []
    } else if (def.type === 'number') {
      params[name] = 1
    } else if (def.type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SAFE_ID
    }
  }
  return { ...params, ...overrides }
}

function buildUrl(tool: PathTool, overrides: Record<string, unknown> = {}): URL {
  return new URL(tool.request.url(buildParams(tool, overrides)))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const ALL_TOOLS = Object.values(cloudflareTools).filter(isCloudflareTool)
const TOOLS = ALL_TOOLS.filter(isPathTool)

/** Surfaced, not swallowed — a silent skip is the blindness this suite fixes. */
const SKIPPED_TOOL_IDS = ALL_TOOLS.filter((tool) => !isPathTool(tool)).map((tool) => tool.id)

/**
 * Tools whose URL will not build even from all-safe values. Distinct from a
 * probe that throws (probing a *guarded* param is supposed to throw): this
 * means the tool cannot be exercised at all, so it would vanish from coverage
 * rather than fail. Asserted empty.
 */
const UNBUILDABLE: string[] = []

/**
 * String literals the URL builder compares against, harvested from its own
 * source so a branching builder is probed on every branch without this file
 * enumerating them. Neither service switches on a literal today — every match
 * set is currently empty — but a tool added later that picks its endpoint from
 * an `action`/`operation` param would otherwise hide the identifiers that only
 * appear on its non-default branch.
 */
function branchLiterals(tool: PathTool): string[] {
  const source = String(tool.request.url)
  const matches = [...source.matchAll(/[=!]==\s*'([^']{1,64})'|'([^']{1,64})'\s*[=!]==/g)]
  return [...new Set(matches.map((match) => match[1] ?? match[2]).filter(Boolean))]
}

interface ProbeContext {
  label: string
  overrides: Record<string, unknown>
}

/**
 * Sibling contexts to probe each param under. A param that only appears on one
 * branch of a conditional builder is invisible to a single all-params probe —
 * no Cloudflare builder branches on a
 * path param today, but probing without each optional param keeps that true as
 * tools are added, rather than assuming it.
 */
function contextsFor(tool: PathTool): ProbeContext[] {
  const contexts: ProbeContext[] = [{ label: 'all params', overrides: {} }]

  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === CREDENTIAL_PARAM || def.required) continue
    contexts.push({ label: `without ${name}`, overrides: { [name]: undefined } })
  }

  for (const literal of branchLiterals(tool)) {
    for (const name of Object.keys(tool.params ?? {})) {
      if (name === CREDENTIAL_PARAM) continue
      contexts.push({ label: `${name}=${literal}`, overrides: { [name]: literal } })
    }
  }

  return contexts
}

interface PathParamCase {
  name: string
  tool: PathTool
  param: string
  overrides: Record<string, unknown>
  baseline: string[]
  /** The query string the tool builds on its own, with no vector involved. */
  baselineSearch: string
}

/**
 * Every (tool, param, branch) case where that param alone reaches the request
 * path, discovered by probing one param at a time under every sibling context.
 * Cases producing an identical path shape are collapsed, so a param guarded the
 * same way on both branches is tested once.
 */
const PATH_PARAM_PAIRS: PathParamCase[] = []
const seenCases = new Set<string>()

for (const tool of TOOLS) {
  for (const context of contextsFor(tool)) {
    for (const param of Object.keys(tool.params ?? {})) {
      if (param === CREDENTIAL_PARAM || param in context.overrides) continue

      let baseline: string[]
      let baselineSearch: string
      try {
        const probed = buildUrl(tool, { ...context.overrides, [param]: PROBE })
        baseline = segmentsOf(probed.pathname)
        baselineSearch = probed.search
      } catch (error) {
        if (context.label === 'all params') {
          UNBUILDABLE.push(`${tool.id} / ${param}: ${(error as Error).message}`)
        }
        continue
      }

      if (!baseline.some((segment) => segment.includes(PROBE))) continue

      const key = `${tool.id}|${param}|${baseline.join('/')}`
      if (seenCases.has(key)) continue
      seenCases.add(key)

      PATH_PARAM_PAIRS.push({
        name: `${tool.id} / ${param}${context.label === 'all params' ? '' : ` (${context.label})`}`,
        tool,
        param,
        overrides: context.overrides,
        baseline,
        baselineSearch,
      })
    }
  }
}

describe('cloudflare path-param traversal safety', () => {
  it('can build every tool that declares a params-based URL', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('accounts for every tool that builds no URL from params', () => {
    expect([...SKIPPED_TOOL_IDS].sort()).toEqual([...TOOLS_WITHOUT_PARAM_BUILT_URLS].sort())
  })

  it('finds every (tool, param) pair that reaches the request path', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(70)
  })

  it('covers multi-param paths, where whole-object fuzzing goes blind', () => {
    const counts = new Map<string, number>()
    for (const { tool } of PATH_PARAM_PAIRS) {
      counts.set(tool.id, (counts.get(tool.id) ?? 0) + 1)
    }

    expect([...counts.values()].filter((count) => count > 1).length).toBeGreaterThanOrEqual(15)
  })

  describe.each(PATH_PARAM_PAIRS)(
    '$name',
    ({ tool, param, overrides, baseline, baselineSearch }) => {
      const withValue = (value: unknown) => buildUrl(tool, { ...overrides, [param]: value })

      it.each(MUST_REJECT)('rejects %j outright', (value) => {
        expect(() => withValue(value)).toThrow(new RegExp(`${param}|path traversal|path separator`))
      })

      it.each(MUST_NEUTRALIZE)('confines %j to a single segment', (value) => {
        const url = withValue(value)

        expect(url.origin).toBe(API_ORIGIN)
        expect(url.pathname.startsWith(API_PREFIX)).toBe(true)
        expect(url.hash).toBe('')

        /**
         * The query string must be byte-identical to what the tool builds alone.
         * Without this, a raw interpolation of `id?x=y` passes every other
         * assertion here: the `?` starts a query, so the PATH keeps its segment
         * count and every surrounding segment, and only `search` reveals that the
         * id was torn in half. Shape alone cannot see it.
         */
        expect(url.search).toBe(baselineSearch)

        const actual = segmentsOf(url.pathname)
        expect(actual).toHaveLength(baseline.length)
        /**
         * Every segment is pinned, including the one under test — it must equal
         * the trimmed, percent-encoded value. Skipping the probe slot would let a
         * balanced traversal (`id/../../other/victim`) pass with the guard gone,
         * because only that slot changes.
         */
        const expected = encodeURIComponent(value.trim())
        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment.replaceAll(PROBE, expected))
        })
      })

      it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
        const actual = segmentsOf(withValue(value).pathname)

        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment.replaceAll(PROBE, value))
        })
      })

      /**
       * A safe-range numeric id must build the same path as its decimal string.
       *
       * This is what catches a pre-trim anywhere in a URL builder. A
       * `params.x?.trim()` ahead of the guard throws a bare
       * `TypeError: params.x?.trim is not a function` on a JSON number, and it
       * throws BEFORE `safeUrlPathSegment` — which accepts numbers and bigints —
       * ever runs. The first version of this suite passed only strings, so the
       * `remove_reaction` and `create_thread` pre-trims survived it; both bots
       * caught what the harness could not.
       */
      it('accepts a safe-range numeric id identically to its decimal string', () => {
        const numeric = 8035111022467891

        expect(segmentsOf(withValue(numeric).pathname)).toEqual(
          segmentsOf(withValue(String(numeric)).pathname)
        )
      })

      it('accepts a bigint id identically to its decimal string', () => {
        const snowflake = 1234567890123456789n

        expect(segmentsOf(withValue(snowflake).pathname)).toEqual(
          segmentsOf(withValue(snowflake.toString()).pathname)
        )
      })

      /**
       * The URL is not the only builder that touches an id. `create_thread` also
       * reads `messageId` in its `body` to decide the thread type, and a
       * `?.trim()` there threw a bare TypeError on a numeric id *after* the URL
       * had already accepted it — caught by review, not by this suite, because
       * the suite only ever exercised `request.url`.
       */
      it('builds body and headers from a numeric id without a TypeError', () => {
        const numericParams = buildParams(tool, { ...overrides, [param]: 8035111022467891 })

        expect(throwsTypeError(() => tool.request.url(numericParams))).toBe(false)
        expect(throwsTypeError(() => tool.request.body?.(numericParams))).toBe(false)
        expect(throwsTypeError(() => tool.request.headers?.(numericParams))).toBe(false)
      })

      it("handles surrounding whitespace per this parameter's policy", () => {
        const padded = `  ${TRIM_SAMPLE}  `

        if (REJECTS_SURROUNDING_WHITESPACE.has(`${tool.id}/${param}`)) {
          expect(() => withValue(padded)).toThrow(/leading or trailing whitespace/)
          return
        }

        const actual = segmentsOf(withValue(padded).pathname)
        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment.replaceAll(PROBE, TRIM_SAMPLE))
        })
      })
    }
  )
})

/**
 * Pins the reason `MUST_REJECT` asserts a throw rather than comparing shape.
 *
 * `zoneId` is the final segment of `DELETE /zones/{zone_id}`, so a bare `.`
 * there addresses the zone *collection* while leaving the segment count and
 * every other segment identical. A shape-only assertion cannot see it. If this
 * test ever fails because the path stopped ending in the id, the reasoning
 * above needs revisiting.
 */
describe('a trailing dot segment is invisible to a shape check', () => {
  const tool = pathToolFor(deleteZoneTool, 'cloudflare_delete_zone')

  it('collapses to the parent collection without changing the segment count', () => {
    const baseline = segmentsOf(
      new URL('https://api.cloudflare.com/client/v4/zones/SAFEID').pathname
    )
    const collapsed = segmentsOf(
      new URL(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent('.')}`).pathname
    )

    expect(collapsed).toHaveLength(baseline.length)
    expect(collapsed.at(-1)).toBe('')
  })

  it('is caught anyway, because the guard rejects rather than encodes', () => {
    expect(() => buildUrl(tool, { zoneId: '.' })).toThrow(/path traversal is not allowed/)
  })
})
