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
 * — the shape this file originally copied — silently stops testing a tool's
 * remaining IDs the moment one of them is guarded, so a route like
 * `/matters/{matterId}/holds/{holdId}` would have been reported as covered
 * while `holdId` was never exercised at all.
 */
import { describe, expect, it } from 'vitest'
import * as googleVaultTools from '@/tools/google_vault/index'
import type { ToolConfig } from '@/tools/types'

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
  '\\..\\..',
] as const

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

type AnyTool = ToolConfig<any, any>

function isGoogleVaultTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('google_vault_')
  )
}

/**
 * Builds a param object with `targetName` set to `value` and every other
 * parameter pinned to a known-safe placeholder of the right shape, so a failure
 * is always attributable to the one parameter under test.
 */
function buildParams(tool: AnyTool, targetName: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { accessToken: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'accessToken') continue
    if (name === targetName) {
      params[name] = value
      continue
    }
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'object') {
      params[name] = {}
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SIBLING
    }
  }
  return params
}

function buildUrl(tool: AnyTool, targetName: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, targetName, value) as any))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/**
 * Every (tool, parameter) pair whose parameter actually reaches the path, found
 * by probing one parameter at a time with a unique marker.
 */
const PATH_PARAM_PAIRS = Object.values(googleVaultTools)
  .filter(isGoogleVaultTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
      .filter((paramName) => paramName !== 'accessToken')
      .filter((paramName) => {
        try {
          return buildUrl(tool, paramName, TARGET).pathname.includes(TARGET)
        } catch {
          return false
        }
      })
      .map((paramName) => ({ name: `${tool.id} / ${paramName}`, tool, paramName }))
  )

describe('google vault path-ID traversal safety', () => {
  it('covers every Google Vault path parameter, not just the first per tool', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(29)
  })

  it('exercises the second ID of every two-ID route', () => {
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

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, paramName, value)
      } catch (error) {
        expect(String(error)).toContain(paramName)
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

    it.each(['..', '.', '  ..  '])('rejects the bare dot segment %j by name', (value) => {
      expect(() => buildUrl(tool, paramName, value)).toThrow(new RegExp(paramName))
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
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
