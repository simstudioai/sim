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
import type { ToolConfig } from '@/tools/types'

const INSTANCE_URL = 'https://example-org.my.salesforce.com'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
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

/**
 * Values a real user legitimately supplies; none may be rejected or altered.
 * The 15- and 18-character record ids and the `__c` custom API names are the
 * point of this list — a guard that rejected them would be a regression.
 */
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

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

/** Parameters that carry credentials or the org host, never a path segment. */
const FIXED_PARAMS: Record<string, unknown> = {
  accessToken: 'token',
  idToken: undefined,
  instanceUrl: INSTANCE_URL,
}

function isSalesforceTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('salesforce_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised. Credential and host
 * parameters are pinned so the test exercises the path, not the org lookup.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { ...FIXED_PARAMS }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name in FIXED_PARAMS) continue
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

const DYNAMIC_PATH_TOOLS = Object.values(salesforceTools)
  .filter(isSalesforceTool)
  .filter((tool) => tool.id !== 'salesforce_query_more')
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildUrl(tool, SAFE_ID).pathname.includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('salesforce path-id traversal safety', () => {
  it('covers every Salesforce tool that interpolates an id into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(20)
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

      expect(url.origin).toBe(INSTANCE_URL)
      expect(url.pathname.startsWith('/services/data/v59.0/')).toBe(true)

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
  { name: 'salesforce_delete_account', tool: salesforceDeleteAccountTool },
  { name: 'salesforce_delete_contact', tool: salesforceDeleteContactTool },
  { name: 'salesforce_delete_opportunity', tool: salesforceDeleteOpportunityTool },
  { name: 'salesforce_describe_object', tool: salesforceDescribeObjectTool },
]

describe.each(HIGH_RISK_TOOLS)('$name path safety', ({ tool }) => {
  it('rejects a bare dot-dot segment instead of silently popping the resource', () => {
    expect(() => buildUrl(tool, '..')).toThrow(/path traversal/)
  })

  it('rejects a bare dot segment', () => {
    expect(() => buildUrl(tool, '.')).toThrow(/path traversal/)
  })

  it('does not let the id inject query parameters', () => {
    const url = buildUrl(tool, '0011234567890ABC?fields=Name')

    expect(url.searchParams.get('fields')).toBeNull()
  })

  it('keeps the request inside the org instance host', () => {
    const url = buildUrl(tool, '0011234567890ABC')

    expect(url.origin).toBe(INSTANCE_URL)
  })
})

describe('salesforce_describe_object custom API names', () => {
  it.each(['My_Object__c', 'Region__c', 'Account'])('accepts %j verbatim', (objectName) => {
    const url = buildUrl(salesforceDescribeObjectTool, objectName)

    expect(url.pathname).toBe(`/services/data/v59.0/sobjects/${objectName}/describe`)
  })
})
