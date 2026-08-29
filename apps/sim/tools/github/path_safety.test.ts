/**
 * @vitest-environment node
 *
 * Guards every GitHub tool against path traversal through an LLM-writable value
 * that gets interpolated into the request path.
 *
 * `owner`, `repo`, `issueNumber`, `pullNumber`, `sha`, `path`, `branch`, `ref`
 * and their siblings are `visibility: 'user-or-llm'`, so prompt injection
 * controls them. Interpolating one raw let a value like `../../repos/victim/private`
 * escape its `/repos/{owner}/{repo}` prefix once `fetch` normalized the URL,
 * re-aiming the request — and the workspace's GitHub token — at an arbitrary
 * repository, including on DELETE routes such as `delete_file` and
 * `delete_release`. `assertRequestUrlMatchesTrust` in `tools/request-transport.ts`
 * only canonicalizes internal `/api/` routes, so nothing downstream catches it.
 *
 * Wrapping the value in `encodeURIComponent` is NOT enough, which is why the
 * vector list below keeps the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched, and the URL parser
 * then removes them as dot segments — popping a segment off a fixed host. It
 * removes the percent-encoded spellings too, so double-encoding is no fix
 * either. Only rejecting the value works.
 *
 * Every assertion resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * Tools are enumerated from the barrel rather than listed, so a newly added
 * GitHub tool that interpolates an unguarded parameter fails this suite.
 */
import { getErrorMessage } from '@sim/utils/errors'
import { describe, expect, it } from 'vitest'
import * as githubTools from '@/tools/github/index'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_VALUES = [
  '..',
  '.',
  '  ..  ',
  '../../repos/victim/private',
  '..%2f..%2frepos/victim/private',
  'octocat/../../../repos/victim/private',
  'octocat?access_token=attacker',
  'octocat#fragment',
  'sim/contents/../../../repos/victim/private',
  '\\..\\..',
  '../',
  './.',
] as const

/**
 * Values a real user legitimately supplies for a single-segment parameter.
 * None may be rejected or altered by the guards.
 */
const LEGITIMATE_IDS = [
  'octocat',
  'my-repo',
  'sim',
  'simstudioai',
  '1234',
  'README.md',
  'ci.yml',
  'v1.2.3',
  '9d1e0e1a3b8a4c2f6d7e8f9a0b1c2d3e4f5a6b7c',
  '..foo',
  'foo..',
  'release-2.0',
] as const

/**
 * Values a real user legitimately supplies for a parameter that addresses a
 * location inside a repository. These carry `/`, so a single-segment guard
 * would reject every one of them — which is why those parameters use
 * `safeUrlPath` instead.
 */
const LEGITIMATE_PATHS = [
  'feature/my-branch',
  'docs/README.md',
  'apps/sim/tools/github/index.ts',
  'heads/release/2.0',
  'octocat:feature/my-branch',
] as const

/**
 * Parameters GitHub documents as slash-delimited. Every other path parameter
 * addresses a single resource and must reject a separator outright.
 */
const MULTI_SEGMENT_PARAMS = new Set(['path', 'branch', 'ref', 'base', 'head'])

/**
 * Filenames whose own leading, trailing, or interior spaces are content, not
 * padding. Git tracks all of these verbatim, so trimming any of them would make
 * `update_file` and `delete_file` act on a different file than the caller named
 * — a silent wrong-target write, which is why `safeUrlPath` does not trim.
 *
 * The last entry is a directory whose entire name is spaces. It is a legal git
 * path and `%20%20%20` is never normalized away, so rejecting it would only
 * make a real file unreachable.
 */
const WHITESPACE_PATHS: ReadonlyArray<readonly [string, string]> = [
  ['docs/my file .txt', 'docs/my%20file%20.txt'],
  ['docs/ leading.md', 'docs/%20leading.md'],
  ['docs/trailing.md ', 'docs/trailing.md%20'],
  ['docs/   /file.txt', 'docs/%20%20%20/file.txt'],
]

/**
 * Parameters the provider reads as one path parameter that may itself contain
 * `/` — a namespaced GitHub label such as `area/api`. The separator must
 * survive as `%2F`, so these neither reject it nor promote it to a boundary.
 */
const ENCODED_SEGMENT_PARAMS = new Set(['name'])

const PROBE = 'PROBEVALUE'
const FILLER = 'SAFEID'
const NUMBER_FILLER = 7

/**
 * The shape this suite needs from a tool, declared structurally rather than as
 * `ToolConfig<any, any>`.
 *
 * The barrel's exports are heterogeneous — `ToolConfig` and `InternalToolConfig`
 * over dozens of unrelated param types — so there is no single concrete
 * instantiation to name here. Describing only the three members the harness
 * touches keeps the boundary typed without `any` and without coupling the suite
 * to any tool's param interface.
 */
interface UrlBuildingTool {
  readonly id: string
  readonly params?: Readonly<Record<string, { readonly type?: string }>>
  readonly request?: { readonly url?: unknown }
}

/**
 * A URL builder as this suite calls it. Each tool declares a narrower param
 * type, but the harness deliberately feeds values those types forbid — a string
 * into a `number` parameter — because that is precisely what an LLM tool call
 * can do and what the guards must survive.
 */
type UrlBuilder = (params: Record<string, unknown>) => string

function isGitHubTool(value: unknown): value is UrlBuildingTool {
  if (typeof value !== 'object' || value === null) return false
  const id: unknown = (value as { id?: unknown }).id
  return typeof id === 'string' && id.startsWith('github')
}

/**
 * Narrows a tool's `url` to a callable, or `null` when the tool serves a fixed
 * URL string (the GraphQL tools) and has no path to exercise.
 */
function urlBuilderOf(tool: UrlBuildingTool): UrlBuilder | null {
  const url = tool.request?.url
  return typeof url === 'function' ? (url as UrlBuilder) : null
}

/**
 * Builds a param object for a tool with one parameter set to `value` and every
 * other string-ish parameter set to a constant, so the assertion isolates the
 * parameter under test.
 *
 * The parameter under test always receives the probe *string*, whatever its
 * declared type. That declaration is not enforced anywhere between the LLM tool
 * call and the URL builder, so an `issue_number` of `'..'` reaches the path
 * exactly like a string one, and a suite that only ever fed numbers there would
 * miss the whole attack.
 *
 * Every *other* number parameter gets a real number, so a sibling's own
 * validation cannot abort the build and hide the parameter under test. Filling
 * them with a string made `job_logs` throw on `job_id` while `owner` was the
 * target, silently dropping that tool from the suite entirely — which is what
 * the skip ledger below now makes impossible.
 */
function buildParams(
  tool: UrlBuildingTool,
  target: string,
  value: string
): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
    const type = def.type
    if (name === target) {
      params[name] = value
    } else if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'boolean') {
      params[name] = false
    } else if (type === 'number') {
      params[name] = NUMBER_FILLER
    } else {
      params[name] = FILLER
    }
  }
  return params
}

function buildUrl(tool: UrlBuildingTool, target: string, value: string): URL {
  const build = urlBuilderOf(tool)
  if (!build) {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(build(buildParams(tool, target, value)))
}

function buildPath(tool: UrlBuildingTool, target: string, value: string): string {
  return buildUrl(tool, target, value).pathname
}

interface PathParamCase {
  name: string
  tool: UrlBuildingTool
  param: string
  baseline: string
}

/**
 * Every (tool, parameter) pair whose value actually reaches the URL path,
 * discovered by probing rather than declared, so a new tool is covered the
 * moment it lands in the barrel.
 */
const PATH_PARAM_CASES: PathParamCase[] = []

/**
 * Every parameter whose baseline could not be built, with the reason.
 *
 * A silent `catch`/`continue` here would hide a tool from the suite entirely —
 * the same class of blindness as an unguarded parameter, and one the aggregate
 * count cannot detect, since a case that never existed cannot fail. So every
 * skip is recorded and then asserted against an explicit expectation below.
 */
const SKIPPED: Array<{ id: string; param: string; reason: string }> = []

for (const tool of Object.values(githubTools).filter(isGitHubTool)) {
  if (!urlBuilderOf(tool)) continue
  for (const param of Object.keys(tool.params ?? {})) {
    if (param === 'apiKey') continue
    let baseline: string
    try {
      baseline = buildPath(tool, param, PROBE)
    } catch (error) {
      SKIPPED.push({
        id: tool.id,
        param,
        reason: getErrorMessage(error, 'unknown failure'),
      })
      continue
    }
    if (!baseline.includes(PROBE)) continue
    PATH_PARAM_CASES.push({ name: `${tool.id} / ${param}`, tool, param, baseline })
  }
}

/**
 * The only parameters allowed to refuse the probe, keyed by the guard that
 * refuses them.
 *
 * `job_id` is validated as a positive integer before it reaches the path, so a
 * string probe is rejected outright — which is the stronger outcome and is
 * already pinned by `job_logs.test.ts`. Anything else appearing here means a
 * tool dropped out of coverage and must be explained or fixed, not tolerated.
 */
const EXPECTED_SKIPS = new Set(['github_job_logs / job_id', 'github_job_logs_v2 / job_id'])

/**
 * Tools that build a URL but put no parameter in its path, so there is nothing
 * for this suite to guard.
 *
 * The `search_*` tools assemble their URL with `URLSearchParams`, and
 * `create_gist` posts to a fixed `/gists`. Listing them explicitly rather than
 * inferring "no path params, therefore fine" is the point: a future tool that
 * loses its coverage — by renaming a parameter, or by building its URL in a way
 * the probe cannot see — shows up here as an unexplained entry instead of
 * quietly vanishing from the suite.
 */
const PATHLESS_TOOLS = new Set([
  'github_search_code',
  'github_search_code_v2',
  'github_search_commits',
  'github_search_commits_v2',
  'github_search_issues',
  'github_search_issues_v2',
  'github_search_repos',
  'github_search_repos_v2',
  'github_search_users',
  'github_search_users_v2',
  'github_create_gist',
  'github_create_gist_v2',
])

describe('github path traversal safety', () => {
  it('covers every GitHub tool parameter that reaches the request path', () => {
    expect(PATH_PARAM_CASES.length).toBeGreaterThanOrEqual(60)
  })

  it('skips no parameter without an accounted-for reason', () => {
    const unexplained = SKIPPED.filter(
      (entry) => !EXPECTED_SKIPS.has(`${entry.id} / ${entry.param}`)
    )

    expect(unexplained).toEqual([])
  })

  it('leaves no URL-building tool outside the suite unaccounted for', () => {
    const builders = Object.values(githubTools)
      .filter(isGitHubTool)
      .filter((tool) => urlBuilderOf(tool) !== null)
      .map((tool) => tool.id)
    const covered = new Set(PATH_PARAM_CASES.map((entry) => entry.tool.id))
    const uncovered = builders.filter((id) => !covered.has(id) && !PATHLESS_TOOLS.has(id))

    expect(uncovered).toEqual([])
  })

  it('covers the multi-segment parameters', () => {
    const covered = new Set(PATH_PARAM_CASES.map((entry) => entry.param))
    for (const param of MULTI_SEGMENT_PARAMS) {
      expect(covered.has(param)).toBe(true)
    }
  })

  describe.each(PATH_PARAM_CASES)('$name', ({ tool, param, baseline }) => {
    const prefix = baseline.slice(0, baseline.indexOf(PROBE))

    it.each(TRAVERSAL_VALUES)('cannot escape its path prefix with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, param, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.github.com')
      expect(url.pathname.startsWith(prefix)).toBe(true)
      expect(url.pathname.split('/')).not.toContain('..')
      expect(url.pathname.split('/')).not.toContain('.')
      if (!MULTI_SEGMENT_PARAMS.has(param)) {
        expect(url.pathname).not.toContain('/victim/')
      }
      expect(url.searchParams.get('access_token')).toBeNull()
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      expect(buildPath(tool, param, value)).toBe(baseline.replaceAll(PROBE, value))
    })

    it('rejects a bare dot-dot instead of silently popping its prefix', () => {
      expect(() => buildPath(tool, param, '..')).toThrow(new RegExp(param))
    })

    it('rejects a bare dot', () => {
      expect(() => buildPath(tool, param, '.')).toThrow(new RegExp(param))
    })

    if (MULTI_SEGMENT_PARAMS.has(param)) {
      it.each(LEGITIMATE_PATHS)('passes multi-segment %j through unchanged', (value) => {
        expect(buildPath(tool, param, value)).toBe(baseline.replaceAll(PROBE, value))
      })

      it.each(WHITESPACE_PATHS)('preserves the whitespace in %j', (value, encoded) => {
        expect(buildPath(tool, param, value)).toBe(baseline.replaceAll(PROBE, encoded))
      })
    } else if (ENCODED_SEGMENT_PARAMS.has(param)) {
      it.each(LEGITIMATE_PATHS)('keeps multi-segment %j inside one segment', (value) => {
        expect(buildPath(tool, param, value)).toBe(
          baseline.replaceAll(PROBE, encodeURIComponent(value))
        )
      })
    } else {
      it.each(LEGITIMATE_PATHS)('rejects multi-segment %j', (value) => {
        expect(() => buildPath(tool, param, value)).toThrow(new RegExp(param))
      })
    }
  })
})
