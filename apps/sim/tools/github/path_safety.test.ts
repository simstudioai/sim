/**
 * @vitest-environment node
 *
 * Guards every GitHub tool that interpolates a parameter into its request path.
 *
 * These parameters are `visibility: 'user-or-llm'`, so prompt injection controls
 * them. Interpolating one raw let a value like `..` pop a segment off the fixed
 * `api.github.com` prefix once `fetch` normalized the URL, re-aiming the request
 * — and the user's GitHub token — at a different resource, including on DELETE.
 *
 * GitHub is the delicate case: `path` on the file tools genuinely carries
 * `src/lib/foo.ts`, and `branch`/`ref` genuinely carry `feature/foo` and
 * `heads/BRANCH`. A single-segment guard on those would break the integrations,
 * so they go through `safeUrlPath` (slashes survive, dot segments do not) while
 * identifiers that can never contain a separator go through
 * `safeUrlPathSegment`.
 *
 * Every assertion resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template,
 * because string matching is exactly what let this through. And every parameter
 * is poisoned *independently*: nearly every template here is `owner` + `repo` +
 * something, so an all-poisoned sweep would only ever exercise `owner` and an
 * unguarded `path` on `delete_file` would sail through.
 *
 * Discovery locates a parameter by finding its sentinel *within* the baseline
 * pathname, not by matching a whole path segment. Two parameters can share one
 * segment — `compare_commits` builds `{base}...{head}` — and whole-segment
 * matching found neither, so the tool's authenticated-SSRF site sat outside the
 * suite entirely while the suite reported full coverage. `DECLARED_SITE_KINDS`
 * and the `UNBUILDABLE` assertion below make both silent-drop modes fail loudly.
 */
import { describe, expect, it } from 'vitest'
import * as githubTools from '@/tools/github/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

/**
 * Parameters that legitimately span several path segments.
 *
 * `name` is `remove_label`'s label name. GitHub places no character
 * restriction on a label name and slashes are conventional in the wild
 * (`area/apiserver`, `kind/bug`, `sig/network`). Verified live against
 * `kubernetes/kubernetes`: `labels/area/apiserver` and `labels/area%2Fapiserver`
 * both return `200` for the same label id, and GitHub echoes the *literal*
 * slash form as the label's canonical `url`. A single-segment guard rejected
 * every such label.
 */
const MULTI_SEGMENT_PARAMS = new Set(['path', 'branch', 'ref', 'name'])

/**
 * Parameters whose provider normalizes a single outer `/` away, so the tool
 * strips it rather than rejecting the value.
 *
 * Only the GitHub contents `path`. Verified live against `immich-app/immich`:
 * `contents/server/` returns `302` with `Location: .../contents/server`, which
 * `fetch` follows to the same `200` the bare form returns, and
 * `contents//server` returns `200` outright. An *interior* `//` is a genuine
 * `404` and stays rejected. See `@/tools/github/contents_path`.
 */
const TRAILING_SLASH_TOLERANT_PARAMS = new Set(['path'])

/**
 * How a parameter's value is expected to reach the path.
 *
 * `segment` and `multi` are the two shared helpers. `encodedSlash` is
 * `compare_commits`, where `base` and `head` share one segment as
 * `{base}...{head}`: a git ref may carry `/`, but emitting it literally is the
 * traversal hole, so the value is escaped into a single inert segment (see
 * `@/tools/github/compare_ref`). `integer` is `job_logs`, whose `job_id` is
 * range-checked rather than encoded. `opaque` is `workflow_id`, which GitHub
 * documents as "the ID of the workflow. You can also pass the workflow file
 * name as a string" — and the file name it hands back from
 * `github_list_workflows` is the repo-relative `.github/workflows/ci.yml`, so
 * the value carries `/` yet must still collapse into one segment.
 */
type SiteKind = 'segment' | 'multi' | 'encodedSlash' | 'integer' | 'opaque'

/**
 * Path-reaching parameters whose guard is not the default for their name, and
 * which discovery MUST therefore find.
 *
 * This manifest is the fix for the blind spot that hid `compare_commits`.
 * Discovery used to locate a parameter by `baseline.indexOf(sentinel)` over
 * *whole* path segments, so `ZZBASEZZ...ZZHEADZZ` — one segment holding two
 * sentinels — matched nothing and both parameters were silently dropped, along
 * with any future parameter that shares a segment. Discovery now searches
 * *within* a segment, and the assertion below fails if any declared site stops
 * being discovered rather than letting it vanish into a passing suite.
 */
const DECLARED_SITE_KINDS = new Map<string, SiteKind>([
  ['github_compare_commits:base', 'encodedSlash'],
  ['github_compare_commits:head', 'encodedSlash'],
  ['github_compare_commits_v2:base', 'encodedSlash'],
  ['github_compare_commits_v2:head', 'encodedSlash'],
  ['github_job_logs:job_id', 'integer'],
  ['github_get_file_content:path', 'multi'],
  ['github_get_tree:path', 'multi'],
  ['github_create_file:path', 'multi'],
  ['github_update_file:path', 'multi'],
  ['github_delete_file:path', 'multi'],
  ['github_remove_label:name', 'multi'],
  ['github_get_workflow:workflow_id', 'opaque'],
  ['github_get_workflow_v2:workflow_id', 'opaque'],
  ['github_trigger_workflow:workflow_id', 'opaque'],
  ['github_trigger_workflow_v2:workflow_id', 'opaque'],
])

/** Rejected by every helper, opaque included: only value rejection kills a dot segment. */
const REJECTED_DOT_SEGMENTS = ['..', '.', '  ..  '] as const

const REJECTED_ANYWHERE = [...REJECTED_DOT_SEGMENTS, '\\..\\..'] as const
const REJECTED_SINGLE_ONLY = ['a/../../b', 'a/b'] as const
const REJECTED_MULTI_ONLY = ['a//b', 'a/../b'] as const

/**
 * Rejected on multi-segment params whose provider does NOT normalize an outer
 * slash away. GitHub's contents API does, so `path` is exempt — see
 * `TRAILING_SLASH_TOLERANT_PARAMS`.
 */
const REJECTED_OUTER_SLASH = ['trailing/', '/leading'] as const

/** Must NOT throw — encoding already neutralizes them — but must not reshape the path. */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/**
 * Additionally neutralized — not rejected — on an `opaque` param.
 *
 * `safeOpaqueUrlSegment` rejects only a value that is *exactly* `.` or `..`,
 * then encodes everything else, so a `/` becomes `%2F` and the whole value is
 * one inert segment whose text merely contains dots. The WHATWG URL parser
 * leaves those alone, which is what makes encoding-everything safe here.
 */
const NEUTRALIZED_OPAQUE_ONLY = ['\\..\\..', 'a/b', 'a//b', 'a/../b', 'a/../../b'] as const

const POSITIVE_SINGLE = ['octo-cat', 'repo.name', '..foo', 'foo..', 'v1.2.3'] as const

/**
 * Spellings GitHub accepts for `workflow_id`, verified live against
 * `simstudioai/sim` (workflow id `150137063`, path `.github/workflows/ci.yml`):
 *
 * - `actions/workflows/150137063` → `200` (numeric id)
 * - `actions/workflows/ci.yml` → `200` (bare file name)
 * - `actions/workflows/.github%2Fworkflows%2Fci.yml` → `200` (encoded path)
 * - `actions/workflows/.github/workflows/ci.yml` → `404` (literal slashes miss
 *   the route entirely)
 *
 * The encoded path form matters because `github_list_workflows` prints
 * `Path: .github/workflows/ci.yml` to the model, so that is the value the model
 * has in hand on the very next call.
 */
const POSITIVE_OPAQUE = [
  ...POSITIVE_SINGLE,
  'ci.yml',
  'main.yaml',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.production.yml',
  '150137063',
] as const
const POSITIVE_MULTI = [
  ...POSITIVE_SINGLE,
  'src/lib/foo.ts',
  'folder/sub/file.name.txt',
  'heads/feature/foo',
] as const

/**
 * Additional spellings the compare endpoint documents. Verified live against
 * `immich-app/immich`: `compare/main...bugfix%2Flive-photo-stuck`,
 * `compare/main...immich-app%3Amain`, and
 * `compare/main...immich-app%3Aimmich%3Amain` all return `200`, so escaping
 * costs no documented form.
 */
const POSITIVE_ENCODED_SLASH = [
  ...POSITIVE_MULTI,
  'octo-cat:main',
  'octo-cat:repo:main',
  'octo-cat:feature/foo',
] as const

/** `job_id` is coerced with `Number(...)`, so these are all `NaN` or out of range. */
const REJECTED_INTEGER = [
  ...REJECTED_ANYWHERE,
  ...REJECTED_SINGLE_ONLY,
  ...NEUTRALIZED,
  '0',
  '-1',
  '1.5',
  '',
] as const

/** A string id is what an LLM actually emits for a `type: 'number'` param. */
const POSITIVE_INTEGER = [42, '42', ' 42 ', '9007199254740991'] as const

function isGithubTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('github_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

/**
 * A parameter's stand-in value, unique per parameter so each path slot is
 * identifiable in the built URL.
 *
 * A `type: 'number'` parameter gets a *numeric* sentinel rather than
 * `ZZNAMEZZ`. `job_logs` range-checks `job_id` before building its path, so an
 * alphabetic sentinel made the whole tool throw — and the old discovery loop
 * swallowed that with `catch { continue }`, leaving `github_job_logs` with
 * zero sites while the suite claimed to cover every tool.
 */
const NUMBER_SENTINELS = new Map<string, string>()

function sentinelFor(name: string, type?: string): string {
  if (type !== 'number') return `ZZ${name.toUpperCase()}ZZ`
  const existing = NUMBER_SENTINELS.get(name)
  if (existing) return existing
  const assigned = String(900_000_001 + NUMBER_SENTINELS.size)
  NUMBER_SENTINELS.set(name, assigned)
  return assigned
}

/** Fills every declared param with its own sentinel so each path slot is identifiable. */
function buildParams(tool: AnyTool, overrides: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries<any>(tool.params ?? {})) {
    if (def.type === 'json' || def.type === 'array') params[name] = []
    else if (def.type === 'boolean') params[name] = false
    else params[name] = sentinelFor(name, def.type)
  }
  return { ...params, ...overrides }
}

function buildUrl(tool: AnyTool, overrides: Record<string, unknown> = {}): URL {
  return new URL((tool.request!.url as (p: any) => string)(buildParams(tool, overrides)))
}

const segmentsOf = (url: URL) => url.pathname.split('/')

/** The shape a guarded value is expected to take once it reaches the path. */
function render(kind: SiteKind, value: string): string {
  const encoded = value.split('/').map(encodeURIComponent)
  if (kind === 'multi') return encoded.join('/')
  if (kind === 'encodedSlash') return encoded.join('%2F')
  return encodeURIComponent(value)
}

interface Site {
  name: string
  key: string
  tool: AnyTool
  param: string
  kind: SiteKind
  sentinel: string
  /** Baseline pathname with this param's sentinel still in place. */
  template: string
}

function kindFor(key: string, param: string): SiteKind {
  return DECLARED_SITE_KINDS.get(key) ?? (MULTI_SEGMENT_PARAMS.has(param) ? 'multi' : 'segment')
}

/** The expected pathname once `value` is substituted for this site's sentinel. */
function expectedPath(site: Site, value: string): string {
  return site.template.replace(site.sentinel, render(site.kind, value))
}

const SITES: Site[] = []

/**
 * Tools whose baseline URL could not be built at all.
 *
 * Recorded and asserted rather than skipped: a `catch { continue }` is what let
 * `github_job_logs` contribute zero sites while the suite reported full
 * coverage. Mirrors `@/tools/discord/path_safety.test`.
 */
const UNBUILDABLE: string[] = []

for (const tool of Object.values(githubTools).filter(isGithubTool)) {
  let baseline: string
  try {
    baseline = buildUrl(tool).pathname
  } catch (error) {
    UNBUILDABLE.push(`${tool.id}: ${(error as Error).message}`)
    continue
  }
  for (const [param, def] of Object.entries<any>(tool.params ?? {})) {
    const sentinel = sentinelFor(param, def.type)
    // A sentinel may sit *inside* a segment alongside another param's, as
    // `compare_commits` does with `{base}...{head}`. Matching whole segments
    // dropped both silently.
    if (!baseline.includes(sentinel)) continue
    const key = `${tool.id}:${param}`
    SITES.push({
      name: `${tool.id} · ${param}`,
      key,
      tool,
      param,
      kind: kindFor(key, param),
      sentinel,
      template: baseline,
    })
  }
}

const SITE_KEYS = new Set(SITES.map((site) => site.key))
const GUARDED_SITES = SITES.filter((site) => site.kind !== 'integer')
const INTEGER_SITES = SITES.filter((site) => site.kind === 'integer')

describe('github path-parameter traversal safety', () => {
  it('covers every GitHub tool parameter that reaches the request path', () => {
    expect(SITES.length).toBeGreaterThanOrEqual(300)
  })

  it('builds a baseline URL for every GitHub tool', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('discovers every declared path-reaching parameter', () => {
    const missing = [...DECLARED_SITE_KINDS.keys()].filter((key) => !SITE_KEYS.has(key))

    expect(missing).toEqual([])
  })

  it('finds both compare parameters inside their shared path segment', () => {
    const compare = SITES.filter((site) => site.tool.id === 'github_compare_commits')

    expect(compare.map((site) => site.param)).toEqual(
      expect.arrayContaining(['owner', 'repo', 'base', 'head'])
    )
  })

  it('covers the file-content path parameter on every file tool', () => {
    const pathSites = SITES.filter((site) => site.param === 'path').map((site) => site.tool.id)

    expect(pathSites).toEqual(
      expect.arrayContaining([
        'github_create_file',
        'github_update_file',
        'github_delete_file',
        'github_get_file_content',
        'github_get_tree',
      ])
    )
  })

  describe('guards every path param independently', () => {
    describe.each(GUARDED_SITES)('$name', (site) => {
      const multiish = site.kind === 'multi' || site.kind === 'encodedSlash'
      const tolerantOfTrailingSlash =
        site.kind === 'multi' && TRAILING_SLASH_TOLERANT_PARAMS.has(site.param)
      const rejected: readonly string[] =
        site.kind === 'opaque'
          ? REJECTED_DOT_SEGMENTS
          : [
              ...REJECTED_ANYWHERE,
              ...(multiish ? REJECTED_MULTI_ONLY : REJECTED_SINGLE_ONLY),
              ...(tolerantOfTrailingSlash || !multiish ? [] : REJECTED_OUTER_SLASH),
            ]
      const neutralized: readonly string[] =
        site.kind === 'opaque' ? [...NEUTRALIZED, ...NEUTRALIZED_OPAQUE_ONLY] : NEUTRALIZED

      it.each(rejected)('rejects %j', (value) => {
        expect(() => buildUrl(site.tool, { [site.param]: value })).toThrow(new RegExp(site.param))
      })

      it.each(neutralized)('neutralizes %j without reshaping the path', (value) => {
        const url = buildUrl(site.tool, { [site.param]: value })

        expect(url.pathname).toBe(expectedPath(site, value))
        expect(url.searchParams.get('foo')).toBeNull()
        expect(url.origin).toBe('https://api.github.com')
      })

      const positive: readonly string[] =
        site.kind === 'encodedSlash'
          ? POSITIVE_ENCODED_SLASH
          : site.kind === 'multi'
            ? POSITIVE_MULTI
            : site.kind === 'opaque'
              ? POSITIVE_OPAQUE
              : POSITIVE_SINGLE

      it.each(positive)('passes %j through intact', (value) => {
        const url = buildUrl(site.tool, { [site.param]: value })

        expect(url.pathname).toBe(expectedPath(site, value))
        expect(url.origin).toBe('https://api.github.com')
        if (site.kind !== 'encodedSlash' && site.kind !== 'opaque') {
          expect(url.pathname).not.toContain('%2F')
          expect(url.pathname).not.toContain('%2f')
        }
      })

      if (site.kind === 'opaque') {
        it('collapses a slash-bearing value into one inert segment', () => {
          const baselineSegments = segmentsOf(buildUrl(site.tool)).length
          const url = buildUrl(site.tool, { [site.param]: '.github/workflows/ci.yml' })

          expect(segmentsOf(url)).toHaveLength(baselineSegments)
          expect(url.pathname).toContain('.github%2Fworkflows%2Fci.yml')
          expect(url.origin).toBe('https://api.github.com')
        })
      }

      if (site.kind === 'encodedSlash') {
        it('escapes a slashed ref into one inert segment', () => {
          const url = buildUrl(site.tool, { [site.param]: 'feature/foo' })

          expect(segmentsOf(url)).toHaveLength(segmentsOf(buildUrl(site.tool)).length)
          expect(url.pathname).toContain('feature%2Ffoo')
          expect(url.pathname).toContain('...')
        })
      }

      if (tolerantOfTrailingSlash) {
        it.each(['src/components', 'packages'] as const)(
          'resolves %j identically with and without an outer slash',
          (value) => {
            const bare = buildUrl(site.tool, { [site.param]: value })

            expect(buildUrl(site.tool, { [site.param]: `${value}/` }).href).toBe(bare.href)
            expect(buildUrl(site.tool, { [site.param]: `/${value}` }).href).toBe(bare.href)
            expect(bare.pathname).toBe(expectedPath(site, value))
          }
        )

        it('still rejects a doubled trailing slash', () => {
          expect(() => buildUrl(site.tool, { [site.param]: 'src/components//' })).toThrow(
            new RegExp(site.param)
          )
        })

        it('still rejects an interior double slash', () => {
          expect(() => buildUrl(site.tool, { [site.param]: 'src//components' })).toThrow(
            new RegExp(site.param)
          )
        })
      }
    })

    describe.each(INTEGER_SITES)('$name', (site) => {
      it.each(REJECTED_INTEGER)('rejects %j', (value) => {
        expect(() => buildUrl(site.tool, { [site.param]: value })).toThrow(new RegExp(site.param))
      })

      it.each(POSITIVE_INTEGER)('accepts the id %j an LLM may emit as a string', (value) => {
        const url = buildUrl(site.tool, { [site.param]: value })

        expect(url.pathname).toBe(site.template.replace(site.sentinel, String(Number(value))))
        expect(url.origin).toBe('https://api.github.com')
      })
    })
  })
})

describe('github label names carry slashes', () => {
  it('builds the literal-slash label URL GitHub returns as canonical', () => {
    const url = new URL(
      (githubTools.githubRemoveLabelTool.request!.url as (p: any) => string)({
        owner: 'kubernetes',
        repo: 'kubernetes',
        issue_number: 1,
        name: 'area/apiserver',
      })
    )

    expect(url.pathname).toBe('/repos/kubernetes/kubernetes/issues/1/labels/area/apiserver')
    expect(url.pathname).not.toContain('%2F')
  })

  it.each(['kind/bug', 'sig/network', 'priority/important-soon'] as const)(
    'accepts the conventional label name %j',
    (name) => {
      expect(() =>
        (githubTools.githubRemoveLabelTool.request!.url as (p: any) => string)({
          owner: 'o',
          repo: 'r',
          issue_number: 1,
          name,
        })
      ).not.toThrow()
    }
  )

  it.each(['..', '.', 'a/../b'] as const)('still rejects the traversal label %j', (name) => {
    expect(() =>
      (githubTools.githubRemoveLabelTool.request!.url as (p: any) => string)({
        owner: 'o',
        repo: 'r',
        issue_number: 1,
        name,
      })
    ).toThrow(/name/)
  })
})

/**
 * `workflow_id` names a workflow *file*, so the slash is part of the value.
 *
 * GitHub's OpenAPI (`components.parameters.workflow-id`) says: "The ID of the
 * workflow. You can also pass the workflow file name as a string." The file
 * name `github_list_workflows` hands the model is the repo-relative
 * `.github/workflows/ci.yml` — it prints `Path: ${w.path}` verbatim — so the
 * model is routinely holding a slash-bearing value when it calls these tools.
 *
 * Verified live against `simstudioai/sim`: the `%2F`-encoded path, the bare
 * file name, and the numeric id all answer `200`, while the literal-slash
 * spelling answers `404`. So the value must reach GitHub as ONE encoded
 * segment — which is exactly `safeOpaqueUrlSegment`.
 */
describe('github workflow ids carry workflow file paths', () => {
  const WORKFLOW_TOOLS = [
    ['github_get_workflow', githubTools.githubGetWorkflowTool],
    ['github_get_workflow_v2', githubTools.githubGetWorkflowV2Tool],
    ['github_trigger_workflow', githubTools.githubTriggerWorkflowTool],
    ['github_trigger_workflow_v2', githubTools.githubTriggerWorkflowV2Tool],
  ] as const

  describe.each(WORKFLOW_TOOLS)('%s', (_id, tool) => {
    const url = (workflow_id: unknown) =>
      new URL(
        (tool.request!.url as (p: any) => string)({
          owner: 'simstudioai',
          repo: 'sim',
          workflow_id,
          ref: 'main',
        })
      )

    it.each(['.github/workflows/ci.yml', 'ci.yml', '150137063'] as const)(
      'accepts the documented spelling %j',
      (value) => {
        expect(() => url(value)).not.toThrow()
      }
    )

    it('joins a slash-bearing workflow file name with %2F in one segment', () => {
      const baseline = url('ci.yml')
      const slashed = url('.github/workflows/ci.yml')

      expect(slashed.pathname.split('/')).toHaveLength(baseline.pathname.split('/').length)
      expect(slashed.pathname).toContain('.github%2Fworkflows%2Fci.yml')
      expect(slashed.pathname).not.toContain('.github/workflows/ci.yml')
      expect(slashed.origin).toBe('https://api.github.com')
    })

    it.each(['..', '.', '  ..  '] as const)('still rejects the dot segment %j', (value) => {
      expect(() => url(value)).toThrow(/workflow_id/)
    })

    it.each(['%2E%2E', '..%2f..', 'a/../b'] as const)(
      'neutralizes %j without popping a segment',
      (value) => {
        const baseline = url('ci.yml')
        const built = url(value)

        expect(built.pathname.split('/')).toHaveLength(baseline.pathname.split('/').length)
        expect(built.origin).toBe('https://api.github.com')
      }
    )
  })
})

/**
 * Path ids that reached their guard through a redundant `String(...)` wrapper.
 *
 * `toGuardedString` rejects `null`/`undefined` *before* coercing precisely so a
 * missing id is reported as "<param> is required". `String(undefined)` is the
 * truthy `'undefined'`, so the wrapper handed the guard a value it happily
 * encoded — and the tool then issued a request for a resource literally named
 * `undefined`. The helper already stringifies a numeric id, so the wrapper only
 * ever defeated the null handling.
 */
const STRINGIFIED_ID_PARAMS = new Set([
  'comment_id',
  'issue_number',
  'milestone_number',
  'pullNumber',
  'reaction_id',
  'release_id',
  'run_id',
  'workflow_id',
])

describe('a missing path id is reported as missing, not requested as "undefined"', () => {
  const MISSING_ID_SITES = SITES.filter((site) => STRINGIFIED_ID_PARAMS.has(site.param))

  it('covers every stringified id parameter', () => {
    expect(new Set(MISSING_ID_SITES.map((site) => site.param))).toEqual(STRINGIFIED_ID_PARAMS)
  })

  describe.each(MISSING_ID_SITES)('$name', (site) => {
    it.each([undefined, null])('reports %j as required', (value) => {
      expect(() => buildUrl(site.tool, { [site.param]: value })).toThrow(
        new RegExp(`${site.param} is required`)
      )
    })

    it.each([undefined, null])('never addresses a resource named for %j', (value) => {
      let pathname: string | null = null
      try {
        pathname = buildUrl(site.tool, { [site.param]: value }).pathname
      } catch {
        pathname = null
      }

      expect(pathname).toBeNull()
    })
  })
})
