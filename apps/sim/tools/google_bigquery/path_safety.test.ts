/**
 * @vitest-environment node
 *
 * Guards every Google BigQuery tool that interpolates an LLM-writable identifier
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
 * `/bigquery/v2/projects/..` would still satisfy).
 */
import { describe, expect, it } from 'vitest'
import * as serviceTools from '@/tools/google_bigquery/index'
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
  'my-project-123',
  'sim-analytics',
  '123456789012',
  'my_dataset',
  '_hidden_dataset',
  'events_2026',
  'my-project:my_dataset',
  'example.com:legacy-project',
  'events$20260101',
  '  my_dataset  ',
  '..foo',
  'foo..',
] as const

const ORIGIN = 'https://bigquery.googleapis.com'
const PATH_PREFIX = '/bigquery/v2/projects/'

type AnyTool = ToolConfig<any, any>

function isServiceTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('google_bigquery_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

function tokenFor(name: string): string {
  return `TOKEN${name.toUpperCase()}TOKEN`
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

/** Every `user-or-llm` string param whose token actually lands in the path. */
function pathParamsOf(tool: AnyTool): string[] {
  let baseline: URL
  try {
    baseline = buildUrl(tool)
  } catch {
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

const PATH_TOOLS = Object.values(serviceTools)
  .filter(isServiceTool)
  .map((tool) => ({ name: tool.id, tool, pathParams: pathParamsOf(tool) }))
  .filter((entry) => entry.pathParams.length > 0)

/**
 * Asserts the resolved path has the baseline's segment count and that every
 * segment except the one carrying `param` is byte-identical, while that one
 * still matches the fixed text surrounding the token (e.g. Vault's `:close`
 * suffix). A `startsWith(prefix)` check alone would pass for `prefix/..`.
 */
function expectSameShape(tool: AnyTool, param: string, actual: URL) {
  const token = tokenFor(param)
  const baseline = segmentsOf(buildUrl(tool))
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

describe('Google BigQuery path traversal safety', () => {
  it('covers every tool that interpolates an identifier into its path', () => {
    expect(PATH_TOOLS.length).toBeGreaterThanOrEqual(11)
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
