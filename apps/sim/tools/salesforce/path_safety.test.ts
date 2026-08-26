/**
 * @vitest-environment node
 *
 * Guards every Salesforce tool that interpolates a parameter into its request
 * path against traversal.
 *
 * Record IDs, object API names, report IDs, and dashboard IDs are all
 * `visibility: 'user-or-llm'`, so prompt injection controls them. Interpolated
 * raw, a value of `..` popped a segment off the fixed
 * `/services/data/v59.0/...` prefix once `fetch` normalized the URL — re-aiming
 * the request, and the user's Salesforce access token, at a different org
 * resource. Several of these tools are DELETE or PATCH.
 *
 * The one multi-segment parameter here is `query_more`'s `nextRecordsUrl`: it
 * is an entire REST resource path (`/services/data/v59.0/query/01g...`) appended
 * to the org's instance URL, so a single-segment guard would break pagination
 * outright. It gets `safeUrlPath` plus a prefix assertion — every cursor
 * Salesforce emits, for `query`, `queryAll`, and the Tooling API alike, is
 * rooted at `/services/data/`, so requiring that root is what actually keeps an
 * LLM-supplied cursor from addressing an unrelated resource. Rejecting dot
 * segments alone would not, because the value sits at the root of the instance
 * URL where there is no prefix left to pop.
 *
 * Every assertion resolves the built URL with `new URL(...)`, the same
 * normalization `fetch` performs, rather than string-matching the template.
 */
import { describe, expect, it } from 'vitest'
import * as salesforceTools from '@/tools/salesforce/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const INSTANCE_URL = 'https://example.my.salesforce.com'

/** The only Salesforce parameter that legitimately spans several segments. */
const MULTI_SEGMENT_PARAMS = new Set(['nextRecordsUrl'])

const REJECTED_ANYWHERE = ['..', '.', '  ..  ', '\\..\\..'] as const
const REJECTED_SINGLE_ONLY = ['a/../../b', 'a/b'] as const
const REJECTED_MULTI_ONLY = ['trailing/', 'a//b', 'a/../b'] as const

/** Encoding already neutralizes these; they must pass but never reshape the path. */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

const POSITIVE_SINGLE = [
  '0015000000ABCDEfgh',
  'Account',
  'Custom_Object__c',
  '..foo',
  'foo..',
] as const

function isSalesforceTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('salesforce_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

const sentinelFor = (name: string) => `ZZ${name.toUpperCase()}ZZ`

function buildParams(tool: AnyTool, overrides: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries<any>(tool.params ?? {})) {
    if (def.type === 'json' || def.type === 'array') params[name] = []
    else if (def.type === 'boolean') params[name] = false
    else params[name] = sentinelFor(name)
  }
  params.instanceUrl = INSTANCE_URL
  params.idToken = undefined
  // Must satisfy the prefix assertion so the baseline path is buildable.
  if ('nextRecordsUrl' in params) {
    params.nextRecordsUrl = `/services/data/v59.0/query/${sentinelFor('nextRecordsUrl')}`
  }
  return { ...params, ...overrides }
}

function buildUrl(tool: AnyTool, overrides: Record<string, unknown> = {}): URL {
  return new URL((tool.request!.url as (p: any) => string)(buildParams(tool, overrides)))
}

interface Site {
  name: string
  tool: AnyTool
  param: string
  multi: boolean
  prefix: string[]
  suffix: string[]
}

const SITES: Site[] = []

for (const tool of Object.values(salesforceTools).filter(isSalesforceTool)) {
  let baseline: string[]
  try {
    baseline = buildUrl(tool).pathname.split('/')
  } catch {
    continue
  }
  for (const param of Object.keys(tool.params ?? {})) {
    // `instanceUrl` is a `hidden` org origin, not a path component.
    if (param === 'instanceUrl') continue
    const index = baseline.indexOf(sentinelFor(param))
    if (index === -1) continue
    SITES.push({
      name: `${tool.id} · ${param}`,
      tool,
      param,
      multi: MULTI_SEGMENT_PARAMS.has(param),
      prefix: baseline.slice(0, index),
      suffix: baseline.slice(index + 1),
    })
  }
}

describe('salesforce path-parameter traversal safety', () => {
  it('covers every Salesforce tool parameter that reaches the request path', () => {
    expect(SITES.length).toBe(25)
  })

  it('covers the multi-segment pagination cursor', () => {
    expect(SITES.map((site) => site.name)).toContain('salesforce_query_more · nextRecordsUrl')
  })

  describe('guards every path param independently', () => {
    describe.each(SITES)('$name', (site) => {
      const rejected = [
        ...REJECTED_ANYWHERE,
        ...(site.multi ? REJECTED_MULTI_ONLY : REJECTED_SINGLE_ONLY),
      ]

      it.each(rejected)('rejects %j', (value) => {
        expect(() => buildUrl(site.tool, { [site.param]: value })).toThrow()
      })

      it.each(NEUTRALIZED)('neutralizes %j without reshaping the path', (value) => {
        const poisoned = site.multi ? `/services/data/v59.0/query/${value}` : value
        const url = buildUrl(site.tool, { [site.param]: poisoned })

        expect(url.origin).toBe(INSTANCE_URL)
        expect(url.pathname.split('/')).toEqual([
          ...site.prefix,
          ...value.split('/').map(encodeURIComponent),
          ...site.suffix,
        ])
        expect(url.searchParams.get('foo')).toBeNull()
      })

      it.each(POSITIVE_SINGLE)('passes %j through unchanged', (value) => {
        const poisoned = site.multi ? `/services/data/v59.0/query/${value}` : value
        const url = buildUrl(site.tool, { [site.param]: poisoned })

        expect(url.pathname.split('/')).toEqual([...site.prefix, value, ...site.suffix])
      })
    })
  })
})

describe('salesforce_query_more nextRecordsUrl prefix assertion', () => {
  const tool = Object.values(salesforceTools)
    .filter(isSalesforceTool)
    .find((candidate) => candidate.id === 'salesforce_query_more')!

  it('accepts the cursor Salesforce actually returns, slashes intact', () => {
    const url = buildUrl(tool, {
      nextRecordsUrl: '/services/data/v59.0/query/01g5000000ABCDEfgh-2000',
    })

    expect(url.pathname).toBe('/services/data/v59.0/query/01g5000000ABCDEfgh-2000')
    expect(url.pathname).not.toContain('%2F')
  })

  it('accepts a Tooling API cursor', () => {
    const url = buildUrl(tool, { nextRecordsUrl: '/services/data/v59.0/tooling/query/01gXX-500' })

    expect(url.pathname).toBe('/services/data/v59.0/tooling/query/01gXX-500')
  })

  it('accepts the cursor without its leading slash', () => {
    const url = buildUrl(tool, { nextRecordsUrl: 'services/data/v59.0/query/01gXX-2000' })

    expect(url.pathname).toBe('/services/data/v59.0/query/01gXX-2000')
  })

  it('rejects a cursor that leaves the REST API root even without a dot segment', () => {
    expect(() => buildUrl(tool, { nextRecordsUrl: '/servlet/servlet.FileDownload' })).toThrow(
      /nextRecordsUrl/
    )
  })

  it('rejects a dot segment inside an otherwise well-rooted cursor', () => {
    expect(() =>
      buildUrl(tool, { nextRecordsUrl: '/services/data/v59.0/query/../../../servlet' })
    ).toThrow(/nextRecordsUrl/)
  })
})
