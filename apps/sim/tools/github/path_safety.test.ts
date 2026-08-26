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
 * Parameters whose provider normalizes a single trailing `/` away, so the
 * tool strips it rather than rejecting the value.
 *
 * Only the GitHub contents `path`. Verified live against `vercel/next.js`:
 * `contents/packages/` returns `302` with `Location: .../contents/packages`,
 * which `fetch` follows to the same `200` the bare form returns. See
 * `@/tools/github/contents_path`.
 */
const TRAILING_SLASH_TOLERANT_PARAMS = new Set(['path'])

/**
 * `compare_commits` interpolates `base` and `head` into `{base}...{head}`.
 * Git refs may contain `/`, and GitHub's own docs additionally define a
 * cross-fork `USERNAME:BASE...USERNAME:HEAD` form whose `:` `encodeURIComponent`
 * would turn into `%3A`. Neither helper can be applied without risking silent
 * breakage of branch comparison, and the docs do not settle the encoding
 * question, so these two sites are deliberately left unguarded and excluded
 * here rather than guarded on a guess.
 */
const UNVERIFIED_SITES = new Set(['github_compare_commits:base', 'github_compare_commits:head'])

const REJECTED_ANYWHERE = ['..', '.', '  ..  ', '\\..\\..'] as const
const REJECTED_SINGLE_ONLY = ['a/../../b', 'a/b'] as const
const REJECTED_MULTI_ONLY = ['/leading', 'a//b', 'a/../b'] as const

/** Rejected on multi-segment params that their provider does NOT normalize. */
const REJECTED_TRAILING_SLASH = ['trailing/'] as const

/** Must NOT throw — encoding already neutralizes them — but must not reshape the path. */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

const POSITIVE_SINGLE = ['octo-cat', 'repo.name', '..foo', 'foo..', 'v1.2.3'] as const
const POSITIVE_MULTI = [
  ...POSITIVE_SINGLE,
  'src/lib/foo.ts',
  'folder/sub/file.name.txt',
  'heads/feature/foo',
] as const

function isGithubTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('github_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

const sentinelFor = (name: string) => `ZZ${name.toUpperCase()}ZZ`

/** Fills every declared param with its own sentinel so each path slot is identifiable. */
function buildParams(tool: AnyTool, overrides: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries<any>(tool.params ?? {})) {
    if (def.type === 'json' || def.type === 'array') params[name] = []
    else if (def.type === 'boolean') params[name] = false
    else params[name] = sentinelFor(name)
  }
  return { ...params, ...overrides }
}

function buildUrl(tool: AnyTool, overrides: Record<string, unknown> = {}): URL {
  return new URL((tool.request!.url as (p: any) => string)(buildParams(tool, overrides)))
}

const segmentsOf = (url: URL) => url.pathname.split('/')

interface Site {
  name: string
  tool: AnyTool
  param: string
  multi: boolean
  /** Segments before the parameter's slot in the baseline path. */
  prefix: string[]
  /** Segments after the parameter's slot in the baseline path. */
  suffix: string[]
}

const SITES: Site[] = []

for (const tool of Object.values(githubTools).filter(isGithubTool)) {
  let baseline: string[]
  try {
    baseline = segmentsOf(buildUrl(tool))
  } catch {
    continue
  }
  for (const param of Object.keys(tool.params ?? {})) {
    if (UNVERIFIED_SITES.has(`${tool.id}:${param}`)) continue
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

describe('github path-parameter traversal safety', () => {
  it('covers every GitHub tool parameter that reaches the request path', () => {
    expect(SITES.length).toBeGreaterThanOrEqual(300)
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
    describe.each(SITES)('$name', (site) => {
      const tolerantOfTrailingSlash = site.multi && TRAILING_SLASH_TOLERANT_PARAMS.has(site.param)
      const rejected = [
        ...REJECTED_ANYWHERE,
        ...(site.multi ? REJECTED_MULTI_ONLY : REJECTED_SINGLE_ONLY),
        ...(tolerantOfTrailingSlash ? [] : site.multi ? REJECTED_TRAILING_SLASH : []),
      ]

      it.each(rejected)('rejects %j', (value) => {
        expect(() => buildUrl(site.tool, { [site.param]: value })).toThrow(new RegExp(site.param))
      })

      it.each(NEUTRALIZED)('neutralizes %j without reshaping the path', (value) => {
        const url = buildUrl(site.tool, { [site.param]: value })

        expect(segmentsOf(url)).toEqual([
          ...site.prefix,
          ...value.split('/').map(encodeURIComponent),
          ...site.suffix,
        ])
        expect(url.searchParams.get('foo')).toBeNull()
        expect(url.origin).toBe('https://api.github.com')
      })

      it.each(site.multi ? POSITIVE_MULTI : POSITIVE_SINGLE)(
        'passes %j through with its separators intact',
        (value) => {
          const url = buildUrl(site.tool, { [site.param]: value })

          expect(segmentsOf(url)).toEqual([...site.prefix, ...value.split('/'), ...site.suffix])
          expect(url.pathname).not.toContain('%2F')
          expect(url.pathname).not.toContain('%2f')
        }
      )

      if (tolerantOfTrailingSlash) {
        it.each(['src/components', 'packages'] as const)(
          'resolves %j identically with and without a trailing slash',
          (value) => {
            const bare = buildUrl(site.tool, { [site.param]: value })
            const trailing = buildUrl(site.tool, { [site.param]: `${value}/` })

            expect(trailing.href).toBe(bare.href)
            expect(segmentsOf(trailing)).toEqual([
              ...site.prefix,
              ...value.split('/'),
              ...site.suffix,
            ])
          }
        )

        it('still rejects a doubled trailing slash', () => {
          expect(() => buildUrl(site.tool, { [site.param]: 'src/components//' })).toThrow(
            new RegExp(site.param)
          )
        })
      }
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
