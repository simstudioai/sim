/**
 * @vitest-environment node
 *
 * Guards every Jira tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * `issueKey`, `commentId`, `worklogId`, `attachmentId`, `linkId`, and
 * `projectId` are `visibility: 'user-or-llm'`, so prompt injection controls
 * them. Interpolating one raw let a value like `../../../project/OTHER` escape
 * its `/rest/api/3/issue/` prefix once `fetch` normalized the URL, re-aiming
 * the request — and the user's Atlassian OAuth token — at a different resource
 * on the same site, including on DELETE. `assertRequestUrlMatchesTrust` in
 * `tools/request-transport.ts` only applies its canonicalization guard to
 * internal `/api/` routes, so nothing downstream catches this.
 *
 * `cloudId` is deliberately pinned here rather than fuzzed. It is
 * `visibility: 'hidden'`, no Jira block subBlock ever writes it, and its only
 * real source is `getJiraCloudId` -> `resolveAtlassianCloudId`, which returns a
 * UUID from Atlassian's own accessible-resources endpoint. Fuzzing it would
 * assert a threat model that does not exist while masking the parameters that
 * do carry one. Pinning it also selects the direct-request branch: without a
 * `cloudId` every tool returns the discovery URL instead.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * The suite enumerates the tool barrel and then, per tool, every declared
 * parameter that reaches a path segment, fuzzing **one parameter at a time**
 * while the others hold a safe value. A new tool — or a new ID parameter on an
 * existing tool — is therefore covered without anyone remembering to register
 * it, and a still-guarded sibling parameter cannot mask an unguarded one by
 * throwing first.
 *
 * Jira builds its URLs in **two** places, and this file has a suite for each.
 * `request.url` covers the call made when a `cloudId` is already present; the
 * second block at the bottom covers the URL a tool constructs inside
 * `transformResponse` after resolving one, which `request.url` cannot expose
 * (`jira_bulk_read.projectId` reaches a path segment only that way). The
 * fallback block discovers its parameters by running `transformResponse`
 * against a stubbed `fetch` and reading back what was requested, so the
 * enumeration is total for URLs a tool actually sends — a URL a tool built but
 * never fetched would still be invisible to both.
 */
import { describe, expect, it } from 'vitest'
import * as jiraTools from '@/tools/jira/index'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../../project/OTHER',
  '..%2f..%2f..%2fproject/OTHER',
  'PROJ-123/../../../project/OTHER',
  'PROJ-123?injectedProbe=attacker',
  'PROJ-123#fragment',
  'PROJ-123/comment/../../../myself',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  'PROJ-123',
  'ABC-1',
  'MY_PROJECT-4567',
  '10001',
  'PROJ',
  '..foo',
  'foo..',
] as const

const SAFE_ID = 'SAFEID'

/** Sentinel for the one parameter under test, so its slots are identifiable. */
const PROBE_ID = 'PROBEID'

const BASE_ORIGIN = 'https://api.atlassian.com'

const CLOUD_ID = '11111111-2222-4333-8444-555555555555'

/** Every per-site Jira REST call this integration makes lives under this prefix. */
const BASE_PATH = `/ex/jira/${CLOUD_ID}/rest/api/3/`

/** Supplied by the platform, never by the model. */
const FIXED_PARAMS: Record<string, unknown> = {
  accessToken: 'token',
  domain: 'example.atlassian.net',
  cloudId: CLOUD_ID,
}

/**
 * The slice of a tool this suite drives. Narrowing to it — rather than reaching
 * for `ToolConfig<any, any>` and an `as any` at the call site — keeps the
 * harness typed end to end while staying agnostic about each tool's own param
 * and response generics, which differ per tool and are irrelevant here.
 */
type ToolParams = Record<string, unknown>

type UrlBuilder = (params: ToolParams) => string

interface ParamDefinition {
  readonly type?: string
}

type TransformResponse = (response: Response, params: ToolParams) => Promise<unknown>

interface PathBuildingTool {
  readonly id: string
  readonly params: Readonly<Record<string, ParamDefinition>>
  readonly buildUrl: UrlBuilder
  /** Present on the Jira tools that re-issue the call after resolving a cloudId. */
  readonly transformResponse: TransformResponse | null
}

/**
 * Narrows a barrel export to a Jira tool that builds its URL from params.
 * Anything else — a type-only re-export, a tool with a static URL — yields
 * `null` and drops out of the suite.
 */
function asPathBuildingTool(value: unknown): PathBuildingTool | null {
  if (typeof value !== 'object' || value === null) return null

  const candidate = value as { id?: unknown; params?: unknown; request?: unknown }
  if (typeof candidate.id !== 'string' || !candidate.id.startsWith('jira_')) return null

  const request = candidate.request as { url?: unknown } | undefined
  if (typeof request?.url !== 'function') return null

  return {
    id: candidate.id,
    params: (candidate.params ?? {}) as Record<string, ParamDefinition>,
    buildUrl: request.url as UrlBuilder,
    transformResponse:
      typeof candidate.transformResponse === 'function'
        ? (candidate.transformResponse as TransformResponse)
        : null,
  }
}

/**
 * Fills every declared parameter with a type-appropriate safe value, then
 * overrides the single parameter under test.
 */
function buildParams(tool: PathBuildingTool, paramName: string, value: string): ToolParams {
  const params: ToolParams = {}
  for (const [name, definition] of Object.entries(tool.params)) {
    if (definition.type === 'json' || definition.type === 'array') {
      params[name] = []
    } else if (definition.type === 'number') {
      params[name] = 1
    } else if (definition.type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SAFE_ID
    }
  }
  Object.assign(params, FIXED_PARAMS)
  params[paramName] = value
  return params
}

function buildUrl(tool: PathBuildingTool, paramName: string, value: string): URL {
  return new URL(tool.buildUrl(buildParams(tool, paramName, value)))
}

function segmentsOf(tool: PathBuildingTool, paramName: string, value: string): string[] {
  return buildUrl(tool, paramName, value).pathname.split('/')
}

/** Every (tool, parameter) pair whose value lands in a URL path segment. */
const PATH_PARAMS = Object.values(jiraTools)
  .map(asPathBuildingTool)
  .filter((tool): tool is PathBuildingTool => tool !== null)
  .flatMap((tool) =>
    Object.keys(tool.params)
      .filter((name) => !(name in FIXED_PARAMS))
      .filter((name) => {
        try {
          return buildUrl(tool, name, PROBE_ID).pathname.includes(PROBE_ID)
        } catch {
          return false
        }
      })
      .map((name) => ({ label: `${tool.id} :: ${name}`, tool, paramName: name }))
  )

describe('jira path-ID traversal safety', () => {
  it('covers every Jira parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(23)
  })

  describe.each(PATH_PARAMS)('$label', ({ tool, paramName }) => {
    const baseline = segmentsOf(tool, paramName, PROBE_ID)

    it('stays under the resolved cloud instance prefix', () => {
      expect(buildUrl(tool, paramName, PROBE_ID).pathname.startsWith(BASE_PATH)).toBe(true)
    })

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, paramName, value)
      } catch {
        return
      }

      expect(url.origin).toBe(BASE_ORIGIN)
      expect(url.pathname.startsWith(BASE_PATH)).toBe(true)

      const actual = url.pathname.split('/')
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(PROBE_ID)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(['..', '.'] as const)('rejects the bare %j segment by name', (value) => {
      expect(() => buildUrl(tool, paramName, value)).toThrow(new RegExp(paramName))
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(tool, paramName, value)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.split(PROBE_ID).join(value))
      })
    })

    it('trims surrounding whitespace without altering the id', () => {
      expect(segmentsOf(tool, paramName, `  ${PROBE_ID}  `)).toEqual(baseline)
    })

    it('does not let the id inject a query parameter', () => {
      const url = buildUrl(tool, paramName, `${PROBE_ID}?injectedProbe=attacker`)

      expect(url.searchParams.get('injectedProbe')).toBeNull()
    })
  })
})

/**
 * The second URL construction.
 *
 * A Jira tool that is invoked without a `cloudId` sends its configured request
 * to the fixed `accessible-resources` discovery endpoint, then builds the real
 * per-site URL inside `transformResponse` and issues it with a bare `fetch`.
 * `PATH_PARAMS` above cannot see that URL — it only inspects what
 * `request.url` returns — and `jira_bulk_read.projectId` reaches a path segment
 * *only* through this second construction, so it would otherwise never be
 * fuzzed at all.
 *
 * This block closes that gap by actually running `transformResponse` with the
 * `cloudId` withheld, against a stubbed `fetch` that records the URLs the tool
 * asks for. Discovery is driven the same way `PATH_PARAMS` is — probe every
 * declared parameter, keep the ones that land in a path segment — so a new tool
 * or a new ID parameter is covered here too, without registration.
 */
const DISCOVERY_PAYLOAD = [{ id: CLOUD_ID, url: `https://${FIXED_PARAMS.domain}`, name: 'example' }]

function stubResponse(): Response {
  return new Response(JSON.stringify(DISCOVERY_PAYLOAD), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function requestedUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Runs a tool's `transformResponse` with `cloudId` withheld and returns the
 * per-site URLs it tried to fetch. The discovery hop itself is filtered out, and
 * a throw is swallowed: a guard rejecting the value is a pass, and the only
 * thing this function reports is what reached the network.
 */
async function fallbackUrls(
  tool: PathBuildingTool,
  paramName: string,
  value: string
): Promise<string[]> {
  if (!tool.transformResponse) return []

  const requested: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL) => {
    requested.push(requestedUrl(input))
    return Promise.resolve(stubResponse())
  }) as typeof globalThis.fetch

  const params = buildParams(tool, paramName, value)
  params.cloudId = undefined

  try {
    await tool.transformResponse(stubResponse(), params)
  } catch {
    /* Only the URLs the tool asked for matter here. */
  } finally {
    globalThis.fetch = originalFetch
  }

  return requested.filter((url) => new URL(url).pathname.startsWith('/ex/jira/'))
}

async function fallbackPaths(
  tool: PathBuildingTool,
  paramName: string,
  value: string
): Promise<string[]> {
  const urls = await fallbackUrls(tool, paramName, value)
  return urls.map((url) => new URL(url).pathname)
}

/**
 * Whether two resolved pathnames differ only where the probe sentinel sat.
 * Segment *count* is part of the shape, which is what catches a popped prefix:
 * a removed dot segment always shortens the path by one.
 */
function hasSameShape(baseline: string, actual: string): boolean {
  const baselineSegments = baseline.split('/')
  const actualSegments = actual.split('/')
  if (baselineSegments.length !== actualSegments.length) return false
  return baselineSegments.every(
    (segment, index) => segment.includes(PROBE_ID) || segment === actualSegments[index]
  )
}

const FALLBACK_CANDIDATES = Object.values(jiraTools)
  .map(asPathBuildingTool)
  .filter((tool): tool is PathBuildingTool => tool !== null)
  .filter((tool) => tool.transformResponse !== null)
  .flatMap((tool) =>
    Object.keys(tool.params)
      .filter((name) => !(name in FIXED_PARAMS))
      .map((name) => ({ label: `${tool.id} :: ${name}`, tool, paramName: name }))
  )

const FALLBACK_PATH_PARAMS: typeof FALLBACK_CANDIDATES = []
for (const candidate of FALLBACK_CANDIDATES) {
  const urls = await fallbackUrls(candidate.tool, candidate.paramName, PROBE_ID)
  if (urls.some((url) => new URL(url).pathname.includes(PROBE_ID))) {
    FALLBACK_PATH_PARAMS.push(candidate)
  }
}

describe('jira path-ID traversal safety in transformResponse-built URLs', () => {
  it('covers every parameter that reaches a path segment of the second URL', () => {
    expect(FALLBACK_PATH_PARAMS.length).toBeGreaterThanOrEqual(24)
  })

  it('reaches jira_bulk_read.projectId, which request.url cannot expose', () => {
    expect(FALLBACK_PATH_PARAMS.map((entry) => entry.label)).toContain(
      'jira_bulk_read :: projectId'
    )
  })

  describe.each(FALLBACK_PATH_PARAMS)('$label', ({ tool, paramName }) => {
    it.each(TRAVERSAL_IDS)('cannot reshape the second URL with %j', async (value) => {
      const baseline = await fallbackPaths(tool, paramName, PROBE_ID)
      const actual = await fallbackPaths(tool, paramName, value)

      for (const pathname of actual) {
        expect(pathname.startsWith(BASE_PATH)).toBe(true)
        expect(baseline.some((shape) => hasSameShape(shape, pathname))).toBe(true)
      }
    })

    it.each(LEGITIMATE_IDS)('passes %j into the second URL unchanged', async (value) => {
      const baseline = await fallbackPaths(tool, paramName, PROBE_ID)
      const actual = await fallbackPaths(tool, paramName, value)

      for (const pathname of baseline.filter((entry) => entry.includes(PROBE_ID))) {
        expect(actual).toContain(pathname.split(PROBE_ID).join(value))
      }
    })
  })
})
