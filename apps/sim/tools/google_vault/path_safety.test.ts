/**
 * @vitest-environment node
 *
 * Guards every Google Vault tool against path traversal through an
 * LLM-writable ID that gets interpolated into the request path.
 *
 * `matterId`, `holdId`, `exportId`, and `savedQueryId` are all
 * `visibility: 'user-or-llm'`, so prompt injection controls them. Each one was
 * interpolated raw (`${params.matterId.trim()}`), which let a value like
 * `../../matters/victim` escape its `/v1/matters/<id>` prefix once `fetch`
 * normalized the URL — re-aiming the request, and the user's Google OAuth
 * bearer token, at a different matter. `delete_matters`, `delete_matters_holds`
 * and `delete_saved_query` are DELETEs, so the reachable damage is destructive.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * The clearest demonstration is the sibling Algolia suite, whose call sites
 * already wrapped every ID in `encodeURIComponent` and still failed precisely
 * — and only — on the bare `.` and `..` vectors.
 *
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * **The suite enumerates (tool, parameter) pairs and fuzzes exactly one
 * parameter at a time**, holding every sibling at a known-safe value. Filling
 * every string parameter with the same hostile value and swallowing the throw
 * silently stops testing a tool's remaining IDs the moment one of them is
 * guarded, so a route like
 * `/matters/{matterId}/holds/{holdId}`
 * would be reported as covered while the second ID was never exercised.
 *
 * **Every pair asserts rejection, not merely that the path keeps its shape.**
 * A shape check cannot see a bare `.` in the *final* segment: a URL ending
 * `/a/.` normalizes to `/a/`, which has the same segment count and the same
 * leading segments as `/a/id`. `delete_matters`, `close_matters` and
 * `undelete_matters` all end in a guarded ID and
 * are all destructive, so a shape-only assertion would be at its weakest
 * exactly where the damage is worst. The first test below pins that property of
 * the URL parser so the reason this file asserts `toThrow` stays visible.
 */
import { getErrorMessage } from '@sim/utils/errors'
import { describe, expect, it } from 'vitest'
import * as googleVaultTools from '@/tools/google_vault/index'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../matters/victim',
  '..%2f..%2fmatters/victim',
  'matter123/../../matters/victim',
  'matter123?injectedParam=attacker',
  'matter123#fragment',
  'matter123/holds/../../../v1/matters',
  '\\\\..\\\\..',
] as const

/** The dot segments, split out because they must be asserted as rejections. */
const DOT_SEGMENTS = ['..', '.', '  ..  '] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  '12345678901234567890',
  'exportId123456',
  'holdId123456',
  'AbCdEf-1234_5678',
  'matter.v2',
  '..foo',
  'foo..',
] as const

/** The value under test; unique so its position in the path is unambiguous. */
const TARGET = 'TARGETID'

/** Every other string parameter is pinned here so only one variable moves. */
const SIBLING = 'SIBLINGID'

const ORIGIN = 'https://vault.googleapis.com'

/** Credentials, not path identifiers; pinned so only one variable moves. */
const CREDENTIAL_PARAMS: readonly string[] = ['accessToken']

/**
 * The shared shape every path-safety harness in this batch uses. Parameterizing
 * `ToolConfig` with `Record<string, unknown>` — rather than the fully-untyped
 * parameterization these harnesses were originally copied from — is what lets
 * `url(...)` be called below with no cast at all. `ALL_EXPORTS` is seeded as
 * `readonly unknown[]` so the type guard is the single narrowing point: a
 * barrel's element union is not assignable to a widened `ToolConfig`, because
 * the param type sits in the contravariant position of `request.url`.
 */
type PathTool = ToolConfig<Record<string, unknown>, ToolResponse>

function isProbeableTool(value: unknown): value is PathTool {
  if (typeof value !== 'object' || value === null) return false
  /** Narrowing a validated object for property reads; never `any`. */
  const candidate = value as Record<string, unknown>
  const request = candidate.request
  return (
    typeof candidate.id === 'string' &&
    candidate.id.startsWith('google_vault_') &&
    typeof candidate.params === 'object' &&
    candidate.params !== null &&
    typeof request === 'object' &&
    request !== null &&
    'url' in request
  )
}

/**
 * Builds a param object with `targetName` set to `value` and every other
 * parameter pinned to a known-safe placeholder of the right shape, so a failure
 * is always attributable to the one parameter under test. `accessToken` is a
 * credential, not a path identifier, and stays fixed.
 */
function buildParams(tool: PathTool, targetName: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { accessToken: 'token' }
  for (const [name, def] of Object.entries(tool.params)) {
    if (CREDENTIAL_PARAMS.includes(name)) continue
    if (name === targetName) {
      params[name] = value
      continue
    }
    if (def.type === 'json' || def.type === 'array') {
      params[name] = []
    } else if (def.type === 'object') {
      params[name] = {}
    } else if (def.type === 'number') {
      params[name] = 1
    } else if (def.type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SIBLING
    }
  }
  return params
}

function buildUrl(tool: PathTool, targetName: string, value: string): URL {
  const builder = tool.request.url
  if (typeof builder !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(builder(buildParams(tool, targetName, value)))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

interface PathParamPair {
  name: string
  tool: PathTool
  paramName: string
}

const ALL_EXPORTS: readonly unknown[] = Object.values(googleVaultTools)
const TOOLS: PathTool[] = ALL_EXPORTS.filter(isProbeableTool)

/** Tools whose URL is a constant string; they have no path parameter to fuzz. */
const STATIC_URL_TOOLS: string[] = TOOLS.filter(
  (tool) => typeof tool.request.url !== 'function'
).map((tool) => tool.id)

/**
 * Probes that threw while being built from entirely safe placeholder values.
 * Surfaced rather than swallowed: a tool dropped here is a tool this suite is
 * silently not testing, which is the failure mode the whole file exists to
 * prevent.
 */
const PROBE_FAILURES: Array<{ tool: string; param: string; reason: string }> = []

const PATH_PARAM_PAIRS: PathParamPair[] = []
for (const tool of TOOLS) {
  if (typeof tool.request.url !== 'function') continue
  for (const paramName of Object.keys(tool.params)) {
    if (CREDENTIAL_PARAMS.includes(paramName)) continue
    try {
      if (buildUrl(tool, paramName, TARGET).pathname.includes(TARGET)) {
        PATH_PARAM_PAIRS.push({ name: `${tool.id} / ${paramName}`, tool, paramName })
      }
    } catch (error) {
      PROBE_FAILURES.push({
        tool: tool.id,
        param: paramName,
        reason: getErrorMessage(error),
      })
    }
  }
}

describe('google vault path-ID traversal safety', () => {
  it('a trailing dot segment is invisible to a shape check, so rejection is asserted', () => {
    const withId = new URL(`https://vault.googleapis.com/a/b/id`)
    const withDot = new URL(`https://vault.googleapis.com/a/b/.`)

    expect(segmentsOf(withDot)).toHaveLength(segmentsOf(withId).length)
    expect(withDot.pathname).toBe('/a/b/')
  })

  it('builds every probe from safe placeholders without dropping a tool', () => {
    expect(PROBE_FAILURES).toEqual([])
    expect(STATIC_URL_TOOLS).toEqual([])
  })

  it('covers every path parameter, not just the first per tool', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(29)
  })

  it('exercises the second ID of every multi-ID route', () => {
    const covered = new Set(PATH_PARAM_PAIRS.map((pair) => pair.name))

    expect(covered).toContain('google_vault_delete_matters_holds / holdId')
    expect(covered).toContain('google_vault_update_matters_holds / holdId')
    expect(covered).toContain('google_vault_add_held_accounts / holdId')
    expect(covered).toContain('google_vault_remove_held_accounts / holdId')
    expect(covered).toContain('google_vault_list_matters_holds / holdId')
    expect(covered).toContain('google_vault_delete_matters_export / exportId')
    expect(covered).toContain('google_vault_list_matters_export / exportId')
    expect(covered).toContain('google_vault_delete_saved_query / savedQueryId')
    expect(covered).toContain('google_vault_list_saved_queries / savedQueryId')
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, paramName }) => {
    const baseline = segmentsOf(buildUrl(tool, paramName, TARGET))

    it.each(DOT_SEGMENTS)('rejects the dot segment %j by name', (value) => {
      expect(() => buildUrl(tool, paramName, value)).toThrow(new RegExp(paramName))
    })

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, paramName, value)
      } catch (error) {
        expect(getErrorMessage(error)).toContain(paramName)
        return
      }

      expect(url.origin).toBe(ORIGIN)
      expect(url.searchParams.get('injectedParam')).toBeNull()

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(TARGET)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged %j', (value) => {
      const actual = segmentsOf(buildUrl(tool, paramName, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(TARGET, value))
      })
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      expect(segmentsOf(buildUrl(tool, paramName, `  ${TARGET}  `))).toEqual(baseline)
    })
  })
})
