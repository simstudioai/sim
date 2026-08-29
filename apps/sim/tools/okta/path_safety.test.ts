/**
 * @vitest-environment node
 *
 * Guards every Okta tool against path traversal through an LLM-writable ID that
 * gets interpolated into the request path.
 *
 * These IDs are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../users/victim` escape the
 * resource collection it addresses once `fetch` normalized the URL, re-aiming
 * the request (and the org's `SSWS` API token) at an arbitrary Okta Management
 * API resource — including on DELETE and on the lifecycle endpoints that
 * deactivate a user or clear their sessions.
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
 * one param per case while every sibling holds a distinct safe value. Fuzzing a
 * whole tool at once cannot work here: the first guarded param throws, the case
 * is skipped, and every sibling silently stops being tested. That matters for
 * Okta specifically because most membership and assignment paths carry two IDs
 * (`groupId` + `userId`, `appId` + `userId`, `appId` + `groupId`, `userId` +
 * `factorId`, `userId` + `roleAssignmentId`), which is exactly the shape a
 * whole-tool fuzz under-tests.
 */
import { describe, expect, it, vi } from 'vitest'
import { executeOktaUpdateGroupOperation } from '@/lib/internal/okta/operations/update-group'
import * as oktaTools from '@/tools/okta/index'
import type { OktaUpdateGroupParams } from '@/tools/okta/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const DOMAIN = 'dev-123456.okta.com'
const API_ORIGIN = `https://${DOMAIN}`

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looked correct while the hole was live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../users/00uVICTIM0000000000',
  '..%2f..%2fusers/00uVICTIM0000000000',
  '00u1a2b3c4D5E6F7G8h9/../../../users',
  '00u1a2b3c4D5E6F7G8h9?sendEmail=true',
  '00u1a2b3c4D5E6F7G8h9#fragment',
  '00u1a2b3c4D5E6F7G8h9/lifecycle/../../../groups',
  '\\..\\..',
] as const

/**
 * Values a real user legitimately supplies; none may be rejected or altered.
 *
 * These are realistic ID shapes, not quoted documentation: Okta's published
 * parameter descriptions type every ID as a bare `string`, so there is no
 * documented character set to pin. `jane.doe@example.com` covers the login
 * form, which the `{id}` path parameter accepts in place of an ID ("An ID,
 * login, or login shortname (as long as the shortname is unambiguous) of an
 * existing Okta user").
 *
 * KNOWN OPEN QUESTION — a login containing `/`. `safeUrlPathSegment` rejects
 * any value carrying a path separator, whereas the previous
 * `encodeURIComponent` emitted `%2F`, which survives URL normalization intact
 * (`/api/v1/users/a%2Fb` stays one segment). So for the nine `{id}` endpoints
 * that accept a login, a `/`-bearing login that Okta may previously have
 * resolved is now refused. Whether Okta ever resolved it is undocumented and
 * could not be confirmed from any reachable Okta source.
 *
 * This is deliberately not worked around here. `%2F` is not itself a traversal
 * vector — only literal `.`/`..` and their percent-encoded spellings are
 * removed by the parser — so the separator check is defense in depth rather
 * than the load-bearing half of the fix, and it lives in shared
 * `@/tools/url-path` used by every integration. Narrowing it is a decision for
 * that module, not for the Okta tools.
 */
const LEGITIMATE_IDS = [
  '00u1a2b3c4D5E6F7G8h9',
  '00g9h8g7f6E5D4C3b2a1',
  '0oa1b2c3d4E5F6G7h8i9',
  '0pr1b2c3d4E5F6G7h8i9',
  'ufsabcdefghij12345',
  'sfa1b2c3d4E5F6G7h8i9',
  'jane.doe@example.com',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

type PathTool = ToolConfig<Record<string, unknown>, ToolResponse>

function isOktaTool(value: unknown): value is PathTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PathTool).id === 'string' &&
    (value as PathTool).id.startsWith('okta_')
  )
}

/**
 * Assigns every declared string param its own alphanumeric sentinel.
 *
 * Distinct sentinels are what make a two-ID path attributable: with one shared
 * value, a guard on either param would look like coverage of both.
 *
 * `domain` is excluded and pinned to a real org host: it is
 * `visibility: 'user-only'` and already goes through `validateOktaDomain`, so
 * feeding it a traversal vector would only assert that guard rather than the
 * path-segment guards under test.
 */
function safeValues(tool: PathTool): Record<string, string> {
  const values: Record<string, string> = {}
  let index = 0
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey' || name === 'domain') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array' || type === 'number' || type === 'boolean') continue
    values[name] = `SAFEID${index++}`
  }
  return values
}

/** Builds a param object with every sibling at its sentinel, overriding one. */
function buildParams(
  tool: PathTool,
  override?: { name: string; value: string }
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    apiKey: 'token',
    domain: DOMAIN,
    ...safeValues(tool),
  }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey' || name === 'domain') continue
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
const PATH_PARAM_PAIRS = Object.values<unknown>(oktaTools)
  .filter(isOktaTool)
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

describe('okta path-ID traversal safety', () => {
  it('covers every Okta tool param that reaches a path segment', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(40)
  })

  it('covers both IDs on every two-ID path', () => {
    const twoIdTools = [
      'okta_add_user_to_group',
      'okta_remove_user_from_group',
      'okta_assign_group_to_app',
      'okta_remove_group_from_app',
      'okta_remove_user_from_app',
      'okta_get_factor',
      'okta_reset_factor',
      'okta_remove_user_role',
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
      'okta_add_user_to_group',
      'okta_assign_group_to_app',
      'okta_get_factor',
      'okta_remove_group_from_app',
      'okta_remove_user_from_app',
      'okta_remove_user_from_group',
      'okta_remove_user_role',
      'okta_reset_factor',
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
      expect(url.pathname.startsWith('/api/v1/')).toBe(true)

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
        expect(actual[index]).toBe(segment === sentinel ? encodeURIComponent(value) : segment)
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

    it('does not let the id forge the sendEmail lifecycle flag', () => {
      const url = buildUrl(tool, { name: param, value: `${sentinel}?sendEmail=true` })

      expect(url.searchParams.get('sendEmail')).not.toBe('true')
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      expect(buildUrl(tool, { name: param, value: `  ${sentinel}  ` }).pathname).toBe(
        buildUrl(tool).pathname
      )
    })
  })
})

/**
 * `okta_update_group` has no `request` block — it is an `InternalToolConfig`
 * whose read-modify-write runs server-side, so the loop above cannot reach it
 * and its `groupId` needs its own coverage. Both the read and the `PUT` reuse
 * the same URL, so an unguarded id re-aims a write.
 */
describe('okta_update_group groupId path safety', () => {
  async function runUpdateGroup(groupId: string): Promise<string> {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      Response.json({ id: 'g', profile: {}, type: 'OKTA_GROUP', created: '', lastUpdated: '' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const params: OktaUpdateGroupParams = {
      apiKey: 'token',
      domain: DOMAIN,
      groupId,
      name: 'Engineering',
    }
    await executeOktaUpdateGroupOperation(params)

    return String(fetchMock.mock.calls[0][0])
  }

  it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', async (groupId) => {
    let requested: string
    try {
      requested = await runUpdateGroup(groupId)
    } catch {
      return
    }

    const url = new URL(requested)
    expect(url.origin).toBe(API_ORIGIN)
    expect(segmentsOf(url.pathname)).toHaveLength(segmentsOf('/api/v1/groups/x').length)
    expect(url.pathname.startsWith('/api/v1/groups/')).toBe(true)
  })

  it('rejects a bare dot-dot segment', async () => {
    await expect(runUpdateGroup('..')).rejects.toThrow(/path traversal/)
  })

  it.each(LEGITIMATE_IDS)('passes %j through unchanged', async (groupId) => {
    const url = new URL(await runUpdateGroup(groupId))

    expect(url.pathname).toBe(`/api/v1/groups/${encodeURIComponent(groupId)}`)
  })
})
