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
 *
 * The unit of coverage is a **(tool, parameter) pair**, not a tool. Fuzzing
 * every parameter of a tool at once and tolerating a throw is unsound: the
 * first guarded parameter throws and silently retires every sibling from the
 * suite. HubSpot is where that mattered most — the association tools put the
 * four parameters `objectType`, `objectId`, `toObjectType` and `toObjectType`
 * into a single path, so guarding the first one would have retired the other
 * three. Each case below fuzzes exactly one parameter while holding its
 * siblings at a safe value, which is what makes "a newly added unguarded path
 * parameter fails CI" actually true. A throw is only accepted as a pass
 * *because* the thrown-at parameter is the one under test.
 */
import { describe, expect, it } from 'vitest'
import { hubspotCreateAssociationTool } from '@/tools/hubspot/create_association'
import { hubspotDeleteAssociationTool } from '@/tools/hubspot/delete_association'
import { hubspotDeleteCompanyTool } from '@/tools/hubspot/delete_company'
import { hubspotDeleteContactTool } from '@/tools/hubspot/delete_contact'
import { hubspotDeleteDealTool } from '@/tools/hubspot/delete_deal'
import * as hubspotTools from '@/tools/hubspot/index'
import { hubspotListAssociationsTool } from '@/tools/hubspot/list_associations'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_VALUES = [
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

/** The value the parameter under test carries when a path is being mapped. */
const TARGET = 'TARGETVALUE'

/** The value every *other* string parameter is pinned to while one is fuzzed. */
const SIBLING = 'SIBLINGVALUE'

type PathTool = ToolConfig<Record<string, unknown>, ToolResponse>

/** Parameters that carry credentials or the host, never a path segment. */
const FIXED_PARAMS: Record<string, unknown> = { accessToken: 'token' }

function isHubSpotTool(value: unknown): value is PathTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.startsWith('hubspot_')
  )
}

/**
 * Narrows one concretely-typed tool export to the structural shape this
 * harness drives.
 *
 * A direct assignment cannot work and must not be forced with a cast: under
 * `strictFunctionTypes` a `ToolConfig<ConcreteParams, R>` is not assignable to
 * `ToolConfig<Record<string, unknown>, ToolResponse>`, because `request.url`
 * accepts the parameter type contravariantly. Re-checking the value at runtime
 * through the same guard is what makes the narrowing sound rather than
 * asserted.
 */
function asPathTool(value: unknown): PathTool {
  if (!isHubSpotTool(value)) {
    throw new Error('expected a HubSpot tool')
  }
  return value
}

/** The placeholder a sibling parameter holds, chosen so the URL still builds. */
function siblingValue(type: string | undefined): unknown {
  if (type === 'json' || type === 'array') return []
  if (type === 'number') return 1
  if (type === 'boolean') return false
  return SIBLING
}

/**
 * Builds a param object with exactly one parameter under test.
 *
 * Every sibling is pinned to a safe placeholder, so a failure can only be
 * attributed to `target`. This is the whole difference from a fill-everything
 * sweep, where the first parameter to throw hides all the others.
 */
function buildParams(tool: PathTool, target: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { ...FIXED_PARAMS }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name in FIXED_PARAMS) continue
    params[name] = name === target ? value : siblingValue((def as { type?: string }).type)
  }
  return params
}

function buildUrl(tool: PathTool, target: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, target, value)))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

/** True when `target` actually lands in the path rather than the query string. */
function reachesPath(tool: PathTool, target: string): boolean {
  try {
    return buildUrl(tool, target, TARGET).pathname.includes(TARGET)
  } catch {
    return false
  }
}

interface PathParamCase {
  name: string
  param: string
  tool: PathTool
}

/**
 * Seeded as `readonly unknown[]` on purpose, so the guard below is the single
 * narrowing point for the whole harness.
 *
 * The barrel's values are a union of concretely-typed `ToolConfig`s, and no
 * member of that union is assignable to the widened `PathTool`: `ToolConfig`
 * places its parameter type in the *contravariant* position of `request.url`
 * and `request.body`. Filtering the union directly does not help either —
 * `Array.prototype.filter`'s type-predicate overload requires the predicate's
 * type to extend the array's element type, so it intersects rather than
 * replaces and leaves the mismatch in place. Widening to `unknown` first is
 * what lets the guard actually narrow, and it keeps a cast out of every call
 * site.
 */
const ALL_EXPORTS: readonly unknown[] = Object.values(hubspotTools)

const PATH_PARAM_CASES: PathParamCase[] = ALL_EXPORTS.filter(isHubSpotTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
      .filter((param) => !(param in FIXED_PARAMS))
      .filter((param) => reachesPath(tool, param))
      .map((param) => ({ name: `${tool.id} / ${param}`, param, tool }))
  )

describe('hubspot path-parameter traversal safety', () => {
  it('covers every (hubspot tool, path parameter) pair', () => {
    expect(PATH_PARAM_CASES.length).toBeGreaterThanOrEqual(35)
  })

  describe.each(PATH_PARAM_CASES)('$name', ({ tool, param }) => {
    const baselineUrl = buildUrl(tool, param, TARGET)
    const baseline = segmentsOf(baselineUrl.pathname)

    it.each(TRAVERSAL_VALUES)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, param, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.hubapi.com')
      expect(url.pathname.startsWith('/')).toBe(true)

      /**
       * A `?` or `#` in the value does not lengthen the path — it moves the
       * tail out of `pathname` entirely — so the segment comparison below is
       * blind to it. Pinning the query and fragment against the baseline is
       * what makes those two vectors real assertions rather than decoration.
       * Comparing to the baseline rather than to empty is deliberate: several
       * tools legitimately build their own query string.
       */
      expect(url.search).toBe(baselineUrl.search)
      expect(url.hash).toBe('')

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === TARGET) return
        expect(actual[index]).toBe(segment)
      })
    })

    /**
     * The shape check above cannot see a bare dot in the *final* segment: `x/.`
     * normalizes to `x/`, which keeps the segment count and leaves every other
     * segment intact. Rejection is the only observable difference, so assert it
     * directly for every parameter rather than only the hand-picked ones below.
     */
    it.each(['.', '..'])('rejects the bare %j segment', (value) => {
      expect(() => buildUrl(tool, param, value)).toThrow(/path traversal/)
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, param, value).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === TARGET ? value : segment)
      })
    })
  })
})

const HIGH_RISK_CASES: ReadonlyArray<{ name: string; tool: PathTool; param: string }> = [
  {
    name: 'hubspot_delete_contact',
    tool: asPathTool(hubspotDeleteContactTool),
    param: 'contactId',
  },
  {
    name: 'hubspot_delete_company',
    tool: asPathTool(hubspotDeleteCompanyTool),
    param: 'companyId',
  },
  { name: 'hubspot_delete_deal', tool: asPathTool(hubspotDeleteDealTool), param: 'dealId' },
  {
    name: 'hubspot_delete_association',
    tool: asPathTool(hubspotDeleteAssociationTool),
    param: 'objectId',
  },
]

describe.each(HIGH_RISK_CASES)('$name path safety', ({ tool, param }) => {
  it('rejects a bare dot-dot segment instead of silently popping the resource', () => {
    expect(() => buildUrl(tool, param, '..')).toThrow(/path traversal/)
  })

  it('rejects a bare dot segment', () => {
    expect(() => buildUrl(tool, param, '.')).toThrow(/path traversal/)
  })

  it('does not let the value inject query parameters', () => {
    const url = buildUrl(tool, param, '12345?properties=email')

    expect(url.searchParams.get('properties')).toBeNull()
  })

  it('preserves a legitimate value verbatim after trimming', () => {
    expect(buildUrl(tool, param, '  12345  ').pathname).toContain(`/${'12345'}`)
  })
})

/**
 * The regression this file exists to prevent. A fill-everything sweep reported
 * these tools as covered while only the *first* of their four path parameters
 * was ever reached, so reverting any of the other three produced no failure.
 */
describe('association tools expose every path parameter separately', () => {
  const ASSOCIATION_TOOLS = [
    {
      name: 'hubspot_create_association',
      tool: asPathTool(hubspotCreateAssociationTool),
      params: ['objectType', 'objectId', 'toObjectType', 'toObjectId'],
    },
    {
      name: 'hubspot_delete_association',
      tool: asPathTool(hubspotDeleteAssociationTool),
      params: ['objectType', 'objectId', 'toObjectType', 'toObjectId'],
    },
    {
      name: 'hubspot_list_associations',
      tool: asPathTool(hubspotListAssociationsTool),
      params: ['objectType', 'objectId', 'toObjectType'],
    },
  ] as const

  it.each(ASSOCIATION_TOOLS)(
    '$name contributes every path parameter it interpolates',
    ({ tool, params }) => {
      const covered = PATH_PARAM_CASES.filter((entry) => entry.tool === tool).map(
        (entry) => entry.param
      )

      expect([...covered].sort()).toEqual([...params].sort())
    }
  )

  it.each(
    ASSOCIATION_TOOLS.flatMap(({ name, tool, params }) =>
      params.map((param) => ({ name, tool, param }))
    )
  )('$name rejects a dot-dot segment in $param', ({ tool, param }) => {
    expect(() => buildUrl(tool, param, '..')).toThrow(/path traversal/)
  })
})
