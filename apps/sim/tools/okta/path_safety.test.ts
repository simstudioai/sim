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
 */
import { describe, expect, it, vi } from 'vitest'
import { executeOktaUpdateGroupOperation } from '@/lib/internal/okta/operations/update-group'
import * as oktaTools from '@/tools/okta/index'
import type { ToolConfig } from '@/tools/types'

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

/** Values a real user legitimately supplies; none may be rejected or altered. */
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

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isOktaTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('okta_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 *
 * `domain` is pinned to a real org host: it is `visibility: 'user-only'` and
 * already goes through `validateOktaDomain`, so feeding it a traversal vector
 * would only assert that guard rather than the path-segment guards under test.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token', domain: DOMAIN }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey' || name === 'domain') continue
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

function buildPath(tool: AnyTool, value: string): string {
  return buildUrl(tool, value).pathname
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(oktaTools)
  .filter(isOktaTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildPath(tool, SAFE_ID).includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('okta path-ID traversal safety', () => {
  it('covers every Okta tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(25)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildPath(tool, SAFE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe(API_ORIGIN)
      expect(url.pathname.startsWith('/api/v1/')).toBe(true)

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildPath(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? encodeURIComponent(value) : segment)
      })
    })

    it('rejects a bare dot-dot segment instead of silently popping the prefix', () => {
      expect(() => buildUrl(tool, '..')).toThrow(/path traversal/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow(/path traversal/)
    })

    it('does not let the id forge the sendEmail lifecycle flag', () => {
      expect(buildUrl(tool, `${SAFE_ID}?sendEmail=true`).searchParams.get('sendEmail')).not.toBe(
        'true'
      )
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      expect(buildPath(tool, `  ${SAFE_ID}  `)).toBe(buildPath(tool, SAFE_ID))
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
  function runUpdateGroup(groupId: string): Promise<string> {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: 'g', profile: {}, type: 'OKTA_GROUP', created: '', lastUpdated: '' })
    )
    vi.stubGlobal('fetch', fetchMock)

    return executeOktaUpdateGroupOperation(
      { apiKey: 'token', domain: DOMAIN, groupId, name: 'Engineering' } as never,
      undefined as never
    ).then(() => String(fetchMock.mock.calls[0][0]))
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
