/**
 * @vitest-environment node
 *
 * Guards every Jira tool that interpolates an LLM-writable identifier
 * into a request path against path traversal.
 *
 * These identifiers are `visibility: 'user-or-llm'`, so prompt injection
 * controls them. Interpolating one raw let a value like `..` escape its API
 * prefix once `fetch` normalized the URL, re-aiming the request — and the
 * user's OAuth token — at a sibling endpoint, including on DELETE.
 *
 * `encodeURIComponent` is NOT a fix: `.` and `..` are unreserved, so they
 * survive encoding untouched and the WHATWG parser then removes them as dot
 * segments. Every assertion below therefore resolves the built URL through
 * `new URL(...)` — the same normalization `fetch` performs — instead of
 * string-matching the template output, and checks the resolved path's segment
 * count and fixed-segment shape rather than a bare `startsWith` prefix (which
 * `/ex/jira/..` would still satisfy).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serviceTools from '@/tools/jira/index'
import type { ToolConfig } from '@/tools/types'

/** Values that must be rejected outright — no encoding neutralizes them. */
const REJECTED = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..'] as const

/**
 * Values that must NOT throw but must stay inside a single path segment:
 * percent-encoded dot segments and an embedded query separator.
 */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Real identifiers a user legitimately supplies; none may be rejected. */
const LEGITIMATE = [
  'ENG-123',
  'SIM-4567',
  '10001',
  'PROJ',
  '  ENG-123  ',
  '..foo',
  'foo..',
] as const

const ORIGIN = 'https://api.atlassian.com'
const PATH_PREFIX = '/ex/jira/'

type AnyTool = ToolConfig<any, any>

function isServiceTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('jira_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

function tokenFor(name: string): string {
  return `TOKEN${name.toUpperCase()}TOKEN`
}

/**
 * Params whose provider declares a closed enum. A probe token is not a legal
 * value for these, so the harness supplies a documented one — otherwise the
 * builder throws and the tool disappears from the suite instead of being
 * covered, which is precisely the silent-skip this file now asserts against.
 */
const ENUM_PARAM_VALUES: Record<string, string> = {
  orderBy: '-created',
}

/**
 * Fills every declared param so whichever one reaches the path is exercised.
 * In-scope (`user-or-llm`) string params get a unique token; everything else
 * gets an inert value.
 */
function buildParams(tool: AnyTool, overrides: Record<string, string>): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    const { type, visibility } = def as { type?: string; visibility?: string }
    if (type === 'json' || type === 'object') params[name] = {}
    else if (type === 'array') params[name] = []
    else if (type === 'number') params[name] = 1
    else if (type === 'boolean') params[name] = false
    else if (name in overrides) params[name] = overrides[name]
    else if (name in ENUM_PARAM_VALUES) params[name] = ENUM_PARAM_VALUES[name]
    else if (visibility === 'user-or-llm') params[name] = tokenFor(name)
    else params[name] = 'inert'
  }
  return params
}

function buildUrl(tool: AnyTool, overrides: Record<string, string> = {}): URL {
  return new URL((tool.request!.url as (p: any) => string)(buildParams(tool, overrides)))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/**
 * Tools whose `request.url` IS a builder but could not be resolved from the
 * probe params. Previously the `catch` below returned `[]`, which silently
 * dropped the tool from the whole suite; the list is now asserted empty so an
 * unbuildable tool is visible rather than skipped.
 */
const UNBUILDABLE: string[] = []

/** Every `user-or-llm` string param whose token actually lands in the path. */
function pathParamsOf(tool: AnyTool): string[] {
  let baseline: URL
  try {
    baseline = buildUrl(tool)
  } catch {
    UNBUILDABLE.push(tool.id)
    return []
  }
  const query = baseline.search
  return Object.entries(tool.params ?? {})
    .filter(([, def]) => {
      const { type, visibility } = def as { type?: string; visibility?: string }
      return visibility === 'user-or-llm' && (type === undefined || type === 'string')
    })
    .map(([name]) => name)
    .filter((name) => baseline.pathname.includes(tokenFor(name)) && !query.includes(tokenFor(name)))
}

/** Every exported Jira tool, whatever shape its `request.url` takes. */
const ALL_TOOLS = Object.values(serviceTools).filter(
  (value): value is AnyTool =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('jira_')
)

/**
 * Tools that POST to an internal Next.js route instead of calling Atlassian
 * directly. Their provider URL is assembled inside the route, so this suite
 * structurally cannot see it — the guards live in
 * the route handlers under `app/api/tools/jira` and are covered by those
 * routes' own tests.
 * Pinned so a tool moving into or out of that shape is not a silent gap.
 */
const INTERNAL_ROUTE_TOOLS = ALL_TOOLS.filter((tool) => typeof tool.request?.url === 'string')
  .map((tool) => tool.id)
  .sort()

const PATH_TOOLS = Object.values(serviceTools)
  .filter(isServiceTool)
  .map((tool) => ({ name: tool.id, tool, pathParams: pathParamsOf(tool) }))
  .filter((entry) => entry.pathParams.length > 0)

/**
 * The exact set of tools whose `request.url` interpolates an LLM-writable
 * identifier into a path. Pinned by name, not by a `>=` floor, so a guard that
 * disappears — or a builder that starts throwing on the probe params — fails
 * here instead of quietly shrinking the suite.
 */
const EXPECTED_PATH_TOOLS = [
  'jira_add_comment',
  'jira_add_watcher',
  'jira_add_worklog',
  'jira_assign_issue',
  'jira_delete_attachment',
  'jira_delete_comment',
  'jira_delete_issue',
  'jira_delete_issue_link',
  'jira_delete_worklog',
  'jira_get_attachments',
  'jira_get_comments',
  'jira_get_project',
  'jira_get_transitions',
  'jira_get_worklogs',
  'jira_remove_watcher',
  'jira_retrieve',
  'jira_transition_issue',
  'jira_update_comment',
  'jira_update_worklog',
]

/**
 * Asserts the resolved path has the baseline's segment count and that every
 * segment except the one carrying `param` is byte-identical, while that one
 * still matches the fixed text surrounding the token (e.g. Vault's `:close`
 * suffix). A `startsWith(prefix)` check alone would pass for `prefix/..`.
 */
function expectSameShape(tool: AnyTool, param: string, actual: URL) {
  expectSameShapeAgainst(buildUrl(tool), param, actual)
}

/** {@link expectSameShape} against an explicit baseline URL. */
function expectSameShapeAgainst(baselineUrl: URL, param: string, actual: URL) {
  const token = tokenFor(param)
  const baseline = segmentsOf(baselineUrl)
  const actualSegments = segmentsOf(actual)

  expect(actual.origin).toBe(ORIGIN)
  expect(actual.pathname.startsWith(PATH_PREFIX)).toBe(true)
  expect(actualSegments).toHaveLength(baseline.length)

  baseline.forEach((segment, index) => {
    const at = segment.indexOf(token)
    if (at === -1) {
      expect(actualSegments[index]).toBe(segment)
      return
    }
    const prefix = segment.slice(0, at)
    const suffix = segment.slice(at + token.length)
    expect(actualSegments[index].startsWith(prefix)).toBe(true)
    expect(actualSegments[index].endsWith(suffix)).toBe(true)
    expect(
      actualSegments[index].slice(prefix.length, actualSegments[index].length - suffix.length)
    ).not.toContain('/')
  })
}

describe('Jira path traversal safety', () => {
  it('covers exactly the tools that interpolate an identifier into their path', () => {
    expect(PATH_TOOLS.map((entry) => entry.name).sort()).toEqual(EXPECTED_PATH_TOOLS)
  })

  it('resolves a probe URL for every tool with a URL builder', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('leaves only the internal-route tools to their route tests', () => {
    expect(INTERNAL_ROUTE_TOOLS).toEqual(['jira_add_attachment', 'jira_update', 'jira_write'])
  })

  describe.each(PATH_TOOLS)('$name', ({ tool, pathParams }) => {
    describe('guards every path param independently', () => {
      for (const param of pathParams) {
        it.each(REJECTED)(`rejects ${param}=%j while the other params stay legitimate`, (value) => {
          expect(() => buildUrl(tool, { [param]: value })).toThrow(
            new RegExp(param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          )
        })

        it.each(NEUTRALIZED)(`neutralizes ${param}=%j without reshaping the path`, (value) => {
          const url = buildUrl(tool, { [param]: value })

          expectSameShape(tool, param, url)
          expect(url.searchParams.get('foo')).toBeNull()
        })

        it.each(LEGITIMATE)(`passes ${param}=%j through unchanged`, (value) => {
          const url = buildUrl(tool, { [param]: value })
          const token = tokenFor(param)
          const baseline = segmentsOf(buildUrl(tool))
          const actual = segmentsOf(url)

          expect(actual).toHaveLength(baseline.length)
          baseline.forEach((segment, index) => {
            expect(actual[index]).toBe(segment.replace(token, encodeURIComponent(value.trim())))
          })
        })
      }
    })
  })
})
