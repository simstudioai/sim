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
 */
import { describe, expect, it } from 'vitest'
import * as jiraTools from '@/tools/jira/index'
import type { ToolConfig } from '@/tools/types'

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

type AnyTool = ToolConfig<any, any>

function isJiraTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('jira_')
  )
}

/**
 * Fills every declared parameter with a type-appropriate safe value, then
 * overrides the single parameter under test.
 */
function buildParams(tool: AnyTool, paramName: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SAFE_ID
    }
  }
  Object.assign(params, FIXED_PARAMS)
  params[paramName] = value
  return params
}

function buildUrl(tool: AnyTool, paramName: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, paramName, value) as any))
}

function segmentsOf(tool: AnyTool, paramName: string, value: string): string[] {
  return buildUrl(tool, paramName, value).pathname.split('/')
}

/** Every (tool, parameter) pair whose value lands in a URL path segment. */
const PATH_PARAMS = Object.values(jiraTools)
  .filter(isJiraTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
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
