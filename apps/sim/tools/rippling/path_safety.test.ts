/**
 * @vitest-environment node
 *
 * Guards every Rippling tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * These IDs are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../users/victim` escape the
 * resource collection it addresses once `fetch` normalized the URL, re-aiming
 * the request (and the workspace's Rippling bearer token) at an arbitrary
 * Rippling resource — including on DELETE.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * The suite enumerates **(tool, param) pairs**, not tools, and fuzzes exactly
 * one param per case while every sibling holds a distinct safe value. Fuzzing
 * a whole tool at once cannot work here: the first guarded param throws, the
 * case is skipped, and every sibling silently stops being tested. That matters
 * for Rippling specifically because several paths carry two IDs
 * (`customObjectApiName` + `fieldApiName`, + `codrId`, + `externalId`), which
 * is exactly the shape a whole-tool fuzz under-tests.
 */
import { describe, expect, it } from 'vitest'
import * as ripplingTools from '@/tools/rippling/index'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const API_ORIGIN = 'https://rest.ripplingapis.com'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looked correct while the hole was live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../users/victim-user',
  '..%2f..%2fusers/victim-user',
  'user_abc/../../../workers',
  'user_abc?expand=secrets',
  'user_abc#fragment',
  'user_abc/records/../../../custom-objects',
  '\\..\\..',
] as const

/**
 * Values a real user legitimately supplies; none may be rejected or altered.
 *
 * `purchase_order__c`, `amount__c`, and `procurement__c` are Rippling's own
 * example custom-object and field API names, taken from its published OpenAPI
 * document (`developer.rippling.com/docs/rest-beta.yaml`). The `__c` suffix is
 * the part worth pinning: an invented lookalike would not have had it.
 *
 * That same document types every path ID as `{ type: 'string', format: 'id' }`
 * and contains no `pattern` constraint anywhere, so Rippling documents no
 * character set for IDs at all. The guard under test therefore asserts nothing
 * about ID shape — it rejects only the separators and dot segments that
 * reshape a URL, which is the one property that does not depend on a format
 * Rippling has never published.
 */
const LEGITIMATE_IDS = [
  'de4d4d4b-3ab4-4f7f-a1d3-6f2f4dd0d0aa',
  '0b91d2b1c4e94f2a9d3f5c7e8a1b2c3d',
  'A1B2C3D4E5F6',
  'purchase_order__c',
  'amount__c',
  'procurement__c',
  'employee_certifications',
  'externalId-2026-01',
  'field.api.name',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

type PathTool = ToolConfig<Record<string, unknown>, ToolResponse>

function isRipplingTool(value: unknown): value is PathTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PathTool).id === 'string' &&
    (value as PathTool).id.startsWith('rippling_')
  )
}

/**
 * Assigns every declared string param its own alphanumeric sentinel.
 *
 * Distinct sentinels are what make a two-ID path attributable: with one shared
 * value, a guard on either param would look like coverage of both.
 */
function safeValues(tool: PathTool): Record<string, string> {
  const values: Record<string, string> = {}
  let index = 0
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array' || type === 'number' || type === 'boolean') continue
    values[name] = `SAFEID${index++}`
  }
  return values
}

/**
 * Builds a param object with every sibling at its sentinel, overriding one.
 */
function buildParams(
  tool: PathTool,
  override?: { name: string; value: string }
): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token', ...safeValues(tool) }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') params[name] = []
    else if (type === 'number') params[name] = 1
    else if (type === 'boolean') params[name] = false
  }
  if (override) params[override.name] = override.value
  return params
}

function buildUrl(tool: PathTool, override?: { name: string; value: string }): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, override)))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

/**
 * Every (tool, param) pair whose sentinel lands in a path segment.
 *
 * The barrel is seeded as `unknown` rather than enumerated at its own type.
 * `Object.values` over a namespace yields a union across every member, and
 * `ToolConfig` puts its param type in the **contravariant** position of
 * `request.url`, so no specific member is assignable to a widened
 * `ToolConfig<Record<string, unknown>, ToolResponse>` — and a bare `.filter`
 * with a type guard intersects rather than replaces, leaving the errors in
 * place. Seeding as `unknown` makes the guard below the single narrowing
 * point, which keeps a cast out of every call site.
 */
const PATH_PARAM_PAIRS = Object.values<unknown>(ripplingTools)
  .filter(isRipplingTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) => {
    let segments: string[]
    try {
      segments = segmentsOf(buildUrl(tool).pathname)
    } catch {
      return []
    }
    return Object.entries(safeValues(tool))
      .filter(([, sentinel]) => segments.includes(sentinel))
      .map(([param, sentinel]) => ({ name: `${tool.id} / ${param}`, tool, param, sentinel }))
  })

describe('rippling path-ID traversal safety', () => {
  it('covers every Rippling tool param that reaches a path segment', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(60)
  })

  it('covers both IDs on every two-ID path', () => {
    const twoIdTools = [
      'rippling_delete_custom_object_field',
      'rippling_delete_custom_object_record',
      'rippling_get_custom_object_field',
      'rippling_get_custom_object_record',
      'rippling_get_custom_object_record_by_external_id',
      'rippling_update_custom_object_field',
      'rippling_update_custom_object_record',
    ]
    for (const toolId of twoIdTools) {
      expect(PATH_PARAM_PAIRS.filter((pair) => pair.tool.id === toolId)).toHaveLength(2)
    }
  })

  it('names every tool that interpolates two guarded params', () => {
    const actualTwoIdTools = [
      ...new Set(
        PATH_PARAM_PAIRS.map((pair) => pair.tool.id).filter(
          (id, _i, all) => all.filter((other) => other === id).length === 2
        )
      ),
    ].sort()

    expect(actualTwoIdTools).toEqual([
      'rippling_delete_custom_object_field',
      'rippling_delete_custom_object_record',
      'rippling_get_custom_object_field',
      'rippling_get_custom_object_record',
      'rippling_get_custom_object_record_by_external_id',
      'rippling_update_custom_object_field',
      'rippling_update_custom_object_record',
    ])
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, param, sentinel }) => {
    const baseline = segmentsOf(buildUrl(tool).pathname)

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, { name: param, value })
      } catch {
        return
      }

      expect(url.origin).toBe(API_ORIGIN)

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === sentinel) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, { name: param, value }).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === sentinel ? value : segment)
      })
    })

    it('rejects a bare dot-dot segment instead of silently popping the prefix', () => {
      expect(() => buildUrl(tool, { name: param, value: '..' })).toThrow(/path traversal/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, { name: param, value: '.' })).toThrow(/path traversal/)
    })

    it('names the offending param in the rejection', () => {
      expect(() => buildUrl(tool, { name: param, value: '..' })).toThrow(new RegExp(param))
    })

    it('does not let the id inject a query parameter', () => {
      const url = buildUrl(tool, { name: param, value: `${sentinel}?expand=secrets` })

      expect(url.searchParams.get('expand')).not.toBe('secrets')
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      expect(buildUrl(tool, { name: param, value: `  ${sentinel}  ` }).pathname).toBe(
        buildUrl(tool).pathname
      )
    })
  })
})
