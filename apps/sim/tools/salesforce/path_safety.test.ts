/**
 * @vitest-environment node
 *
 * Guards every Salesforce tool against path traversal through an LLM-writable
 * identifier — a record id, a report or dashboard id, or an sObject API name —
 * that gets interpolated into the request path.
 *
 * These parameters are `visibility: 'user-or-llm'`, so prompt injection
 * controls them. Interpolating one raw let a value like
 * `../../../v59.0/sobjects/Account/001` escape the record it addresses once
 * `fetch` normalized the URL, re-aiming the request — with the user's
 * Salesforce OAuth bearer token still attached — at an arbitrary object in the
 * org, including on the DELETE tools.
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
 * suite, so a tool that already has one guard stops testing the rest. Each
 * case below fuzzes exactly one parameter while holding its siblings at a safe
 * value, which is what makes "a newly added unguarded path parameter fails CI"
 * actually true. A throw is only accepted as a pass *because* the thrown-at
 * parameter is the one under test.
 *
 * `salesforce_query_more` is deliberately out of scope: its `nextRecordsUrl`
 * parameter is by contract a whole relative path handed back by a previous
 * query, so it is multi-segment by design and single-segment guarding would
 * break every legitimate call.
 */
import { describe, expect, it } from 'vitest'
import { salesforceDeleteAccountTool } from '@/tools/salesforce/delete_account'
import { salesforceDeleteContactTool } from '@/tools/salesforce/delete_contact'
import { salesforceDeleteOpportunityTool } from '@/tools/salesforce/delete_opportunity'
import { salesforceDescribeObjectTool } from '@/tools/salesforce/describe_object'
import * as salesforceTools from '@/tools/salesforce/index'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const INSTANCE_URL = 'https://example-org.my.salesforce.com'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_VALUES = [
  '..',
  '.',
  '  ..  ',
  '../../../v59.0/sobjects/Account/0011234567890ABC',
  '..%2f..%2fsobjects/Account',
  '0011234567890ABC/../../../limits',
  '0011234567890ABC?fields=Name',
  '0011234567890ABC#fragment',
  '0011234567890ABC/../Contact/003',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  '0011234567890ABC',
  '0011234567890ABCDE',
  '003Hn00000ABCDEIA3',
  '00Q5f000004abcdEAA',
  'Account',
  'Contact',
  'My_Object__c',
  'Region__c',
  'Custom_Field_Name__c',
  '01Z5f000000abcdEAA',
] as const

/** The value the parameter under test carries when a path is being mapped. */
const TARGET = 'TARGETVALUE'

/** The value every *other* string parameter is pinned to while one is fuzzed. */
const SIBLING = 'SIBLINGVALUE'

type PathTool = ToolConfig<Record<string, unknown>, ToolResponse>

/** Parameters that carry credentials or the host, never a path segment. */
const FIXED_PARAMS: Record<string, unknown> = {
  accessToken: 'token',
  idToken: undefined,
  instanceUrl: INSTANCE_URL,
}

function isSalesforceTool(value: unknown): value is PathTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.startsWith('salesforce_')
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
  if (!isSalesforceTool(value)) {
    throw new Error('expected a Salesforce tool')
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

/**
 * Classifies one parameter by where its value lands in the built URL.
 *
 * `unbuildable` is a distinct outcome rather than being folded into `other` on
 * purpose. `TARGET` is a perfectly legitimate value, so a URL builder that
 * throws on it is a defect in the tool or in this harness — and quietly
 * dropping the pair would shrink coverage without failing anything. The
 * unbuildable set is asserted empty below instead.
 */
function classifyParam(tool: PathTool, param: string): 'path' | 'other' | 'unbuildable' {
  try {
    return buildUrl(tool, param, TARGET).pathname.includes(TARGET) ? 'path' : 'other'
  } catch {
    return 'unbuildable'
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
const ALL_EXPORTS: readonly unknown[] = Object.values(salesforceTools)

const CANDIDATE_PARAMS: ReadonlyArray<{ tool: PathTool; param: string }> = ALL_EXPORTS.filter(
  isSalesforceTool
)
  .filter((tool) => tool.id !== 'salesforce_query_more')
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
      .filter((param) => !(param in FIXED_PARAMS))
      .map((param) => ({ tool, param }))
  )

function nameOf({ tool, param }: { tool: PathTool; param: string }): string {
  return `${tool.id} / ${param}`
}

const UNBUILDABLE_PARAMS: readonly string[] = CANDIDATE_PARAMS.filter(
  (candidate) => classifyParam(candidate.tool, candidate.param) === 'unbuildable'
).map(nameOf)

const PATH_PARAM_CASES: PathParamCase[] = CANDIDATE_PARAMS.filter(
  (candidate) => classifyParam(candidate.tool, candidate.param) === 'path'
).map((candidate) => ({ name: nameOf(candidate), param: candidate.param, tool: candidate.tool }))

describe('salesforce path-parameter traversal safety', () => {
  /**
   * Exact, not a floor. A floor lets a pair silently fall out of the sweep — a
   * renamed parameter, or a URL builder that stops interpolating one — while
   * the suite still reports green, which would quietly retire the guarantee
   * this file exists to provide. Changing this number should be a deliberate
   * edit accompanying a real change to the tool surface.
   */
  it('covers exactly every (salesforce tool, path parameter) pair', () => {
    expect(PATH_PARAM_CASES).toHaveLength(23)
  })

  /**
   * A builder that throws on `TARGET` would be silently classified as "not a
   * path parameter" and vanish from the sweep, so name the failure instead.
   */
  it('builds a URL for every candidate parameter from a safe value', () => {
    expect(UNBUILDABLE_PARAMS).toEqual([])
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

      expect(url.origin).toBe(INSTANCE_URL)
      expect(url.pathname.startsWith('/services/data/v59.0/')).toBe(true)

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
    name: 'salesforce_delete_account',
    tool: asPathTool(salesforceDeleteAccountTool),
    param: 'accountId',
  },
  {
    name: 'salesforce_delete_contact',
    tool: asPathTool(salesforceDeleteContactTool),
    param: 'contactId',
  },
  {
    name: 'salesforce_delete_opportunity',
    tool: asPathTool(salesforceDeleteOpportunityTool),
    param: 'opportunityId',
  },
  {
    name: 'salesforce_describe_object',
    tool: asPathTool(salesforceDescribeObjectTool),
    param: 'objectName',
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
    const url = buildUrl(tool, param, '0011234567890ABC?fields=Name')

    expect(url.searchParams.get('fields')).toBeNull()
  })

  it('preserves a legitimate value verbatim after trimming', () => {
    expect(buildUrl(tool, param, '  0011234567890ABC  ').pathname).toContain(
      `/${'0011234567890ABC'}`
    )
  })
})

describe('salesforce_describe_object custom API names', () => {
  it.each(['My_Object__c', 'Region__c', 'Account'])('accepts %j verbatim', (objectName) => {
    const url = buildUrl(asPathTool(salesforceDescribeObjectTool), 'objectName', objectName)

    expect(url.pathname).toBe(`/services/data/v59.0/sobjects/${objectName}/describe`)
  })
})
