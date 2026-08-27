/**
 * @vitest-environment node
 *
 * Guards every Trigger.dev tool that interpolates a parameter into its request
 * path against path traversal.
 *
 * Those parameters are `visibility: 'user-or-llm'`, so prompt injection
 * controls them. `encodeURIComponent` is NOT a fix: `.` and `..` are
 * unreserved, so they survive encoding untouched and the WHATWG parser then
 * removes them as dot segments. Against the live API a `..` collapses the
 * route onto its collection:
 *
 * ```
 * DELETE .../api/v1/projects/proj_abc/envvars/dev/MYVAR -> 401 (route matched)
 * DELETE .../api/v1/projects/proj_abc/envvars/dev/..    -> 301 -> .../envvars
 * ```
 *
 * No collapsed route was reachable with a consequence — `PUT/POST /envvars`,
 * `DELETE /api/v1/schedules`, `POST /api/v2/cancel` and `GET /api/v3` all 404 —
 * so this pins a uniform guard rather than closing a live exploit.
 *
 * Two parameter classes exist, and the split is load-bearing:
 *
 * - **Strict** parameters are opaque, documented, single-segment identifiers
 *   (`proj_…`, `sched_…`, `run_…`, the `dev|staging|prod` enum, an env var
 *   name, a deployment version like `20250228.1`). A `/` in one of those means
 *   the caller passed something other than what the parameter addresses, so it
 *   is rejected outright by `safeUrlPathSegment`.
 * - **Separator-tolerant** parameters are `queueName` and `taskIdentifier`.
 *   Trigger.dev's own SDK special-cases a `/` inside a queue parameter
 *   (`@trigger.dev/core` `v3/apiClient/index.js`:
 *   `encodeURIComponent(value.replace(/\//g, "%2F"))`), which is only
 *   meaningful if a queue name — and, via `{ type: 'task', name }`, a task
 *   identifier — may legitimately contain one. Rejecting a `/` there would be
 *   a false rejection, so those keep `encodeURIComponent`, which already
 *   confines the value to one inert segment.
 *
 * Every assertion resolves the built URL through `new URL(...)` — the same
 * normalization `fetch` performs — because string-matching the template is
 * exactly what let this through.
 */
import { describe, expect, it } from 'vitest'
import * as triggerDevTools from '@/tools/trigger_dev/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const ORIGIN = 'https://api.trigger.dev'
const API_PREFIX_SEGMENTS = ['', 'api'] as const

/** Dot segments. No encoding neutralizes these; every parameter must reject them. */
const DOT_SEGMENTS = ['..', '.', '  ..  '] as const

/**
 * Values carrying a path separator. Strict parameters reject them; the two
 * separator-tolerant parameters percent-encode them into one inert segment.
 */
const SEPARATOR_VECTORS = ['a/b', 'a/../../b', '..\\..', '\\..\\..'] as const

/**
 * Vectors `encodeURIComponent` genuinely does neutralize — `%` and `?` are
 * escaped, so the value stays one inert segment. These must NOT throw for any
 * parameter, and they are the vectors that reach a *second* path parameter: a
 * rejected value throws at the first guard, masking an unguarded one further
 * along.
 */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Values a real caller supplies; every one must survive byte-identical. */
const LEGITIMATE = [
  'run_abc123',
  'proj_xyz',
  'prod',
  'MY_VAR',
  '20250228.1',
  '..foo',
  'foo..',
] as const

function isTriggerDevTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('trigger_dev_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

function safeValueFor(name: string): string {
  return `SAFE${name}`
}

/**
 * Fills every declared param with a legitimate, per-param-unique value, then
 * overrides `target` with `value`. Non-string params get type-appropriate
 * stand-ins so the URL builder runs to completion.
 */
function buildParams(tool: AnyTool, target: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === target) {
      params[name] = value
      continue
    }
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') params[name] = []
    else if (type === 'number') params[name] = 1
    else if (type === 'boolean') params[name] = false
    else params[name] = safeValueFor(name)
  }
  return params
}

function buildUrl(tool: AnyTool, target: string, value: string): URL {
  return new URL((tool.request!.url as (p: any) => string)(buildParams(tool, target, value)))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

interface PathSite {
  name: string
  tool: AnyTool
  param: string
  separatorTolerant: boolean
}

/**
 * Discovers path-zone parameters reflectively rather than by grep: several
 * tools route through a shared URL builder rather than interpolating
 * `params.x` inline, which a grep over the templates would miss.
 *
 * The sentinel is matched *within* `pathname`, never by `segments.indexOf` on
 * whole segments — the whole-segment form silently skips any parameter that
 * shares a segment with another, and that blind spot has hidden a real defect
 * before.
 */
function collectPathSites(): { sites: PathSite[]; unbuildable: string[] } {
  const sites: PathSite[] = []
  const unbuildable: string[] = []
  for (const tool of Object.values(triggerDevTools)) {
    if (!isTriggerDevTool(tool)) continue
    for (const [param, def] of Object.entries(tool.params ?? {})) {
      if ((def as { type?: string }).type !== 'string') continue
      const probe = 'ZQPROBEQZ'
      let url: URL
      try {
        url = buildUrl(tool, param, probe)
      } catch (error) {
        unbuildable.push(`${tool.id}.${param}: ${(error as Error).message}`)
        continue
      }
      if (!url.pathname.includes(probe)) continue
      let separatorTolerant = true
      try {
        buildUrl(tool, param, 'a/b')
      } catch {
        separatorTolerant = false
      }
      sites.push({ name: `${tool.id}.${param}`, tool, param, separatorTolerant })
    }
  }
  return { sites, unbuildable }
}

const { sites: PATH_SITES, unbuildable: UNBUILDABLE } = collectPathSites()

/**
 * The exact number of path-zone parameters across the Trigger.dev tool set.
 *
 * Exact, not a floor: a floor lets sites silently STOP being discovered — a
 * URL builder that starts throwing, a param retyped away from `string`, a tool
 * dropped from the barrel — while the suite still reports green. Raise this
 * deliberately when a tool or a path parameter is added.
 */
const EXPECTED_PATH_SITES = 42

/**
 * The complete inventory of parameters that keep `/` encoded rather than
 * rejected, pinned by name so a new parameter cannot silently join this class.
 * See the module note for the SDK evidence behind each one.
 */
const EXPECTED_SEPARATOR_TOLERANT = [
  'trigger_dev_batch_trigger_task.taskIdentifier',
  'trigger_dev_get_queue.queueName',
  'trigger_dev_override_queue_concurrency.queueName',
  'trigger_dev_pause_queue.queueName',
  'trigger_dev_reset_queue_concurrency.queueName',
  'trigger_dev_resume_queue.queueName',
  'trigger_dev_trigger_task.taskIdentifier',
] as const

/** Multi-path-parameter tools, where the independence block below has teeth. */
const EXPECTED_MULTI_PARAM_TOOLS = 6

describe('trigger.dev path-parameter traversal safety', () => {
  it('covers every Trigger.dev tool parameter that reaches the request path', () => {
    expect(PATH_SITES.length).toBe(EXPECTED_PATH_SITES)
  })

  /**
   * Discovery tolerates a URL builder that throws on a legitimate probe value,
   * because a tool may reject a *different* parameter first. Tolerating it
   * silently is the hazard: a tool that became entirely unbuildable would drop
   * out of PATH_SITES and read as covered. Every skip is recorded and this
   * assertion names it.
   */
  it('builds a URL for every declared string parameter', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('keeps the separator-tolerant class to the documented parameters', () => {
    expect(
      PATH_SITES.filter((site) => site.separatorTolerant)
        .map((site) => site.name)
        .sort()
    ).toEqual([...EXPECTED_SEPARATOR_TOLERANT])
  })

  describe.each(PATH_SITES)('$name', ({ tool, param, separatorTolerant }) => {
    const baseline = segmentsOf(buildUrl(tool, param, safeValueFor(param)))
    const marker = safeValueFor(param)

    /** Asserts the value landed in exactly one segment and moved nothing else. */
    function expectShapePreserved(value: string) {
      const url = buildUrl(tool, param, value)
      const actual = segmentsOf(url)

      expect(url.origin).toBe(ORIGIN)
      expect(actual.slice(0, API_PREFIX_SEGMENTS.length)).toEqual([...API_PREFIX_SEGMENTS])
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === marker) {
          expect(actual[index]).not.toContain('/')
          return
        }
        expect(actual[index]).toBe(segment)
      })
      expect(url.searchParams.get('foo')).toBeNull()
    }

    it.each(DOT_SEGMENTS)('rejects %j instead of reshaping the path', (value) => {
      expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
    })

    it.each(SEPARATOR_VECTORS)('handles the separator vector %j', (value) => {
      if (separatorTolerant) {
        expectShapePreserved(value)
        return
      }
      expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
    })

    it.each(NEUTRALIZED)('neutralizes %j into a single inert segment', (value) => {
      expectShapePreserved(value)
    })

    it.each(LEGITIMATE)('passes %j through byte-identical', (value) => {
      const actual = segmentsOf(buildUrl(tool, param, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === marker ? value : segment)
      })
    })

    it('lands a percent-encoded legitimate value as one segment that decodes back', () => {
      const value = separatorTolerant ? 'my/queue' : 'a b'
      const actual = segmentsOf(buildUrl(tool, param, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment !== marker) {
          expect(actual[index]).toBe(segment)
          return
        }
        expect(actual[index]).not.toContain('/')
        expect(decodeURIComponent(actual[index])).toBe(value)
      })
    })
  })
})

/**
 * The independence check. Poisoning *every* parameter at once passes even when
 * a second path parameter is unguarded, because the first guard throws before
 * the second is ever reached. Each case below poisons exactly one parameter
 * and leaves the rest legitimate.
 */
describe('guards every path param independently', () => {
  const BY_TOOL = PATH_SITES.reduce<Map<string, PathSite[]>>((acc, site) => {
    acc.set(site.tool.id, [...(acc.get(site.tool.id) ?? []), site])
    return acc
  }, new Map())

  const MULTI = [...BY_TOOL.entries()]
    .filter(([, sites]) => sites.length > 1)
    .map(([id, sites]) => ({ id, sites }))

  it('finds multi-parameter templates to check', () => {
    expect(MULTI.length).toBe(EXPECTED_MULTI_PARAM_TOOLS)
  })

  describe.each(MULTI)('$id', ({ sites }) => {
    it.each(sites.map((s) => s.param))('rejects a bare ".." in %s alone', (param) => {
      const site = sites.find((s) => s.param === param)!
      expect(() => buildUrl(site.tool, param, '..')).toThrow(new RegExp(param))
    })

    it.each(sites.map((s) => s.param))(
      'keeps the path shape when only %s carries an encoded vector',
      (param) => {
        const site = sites.find((s) => s.param === param)!
        const baseline = segmentsOf(buildUrl(site.tool, param, safeValueFor(param)))
        const actual = segmentsOf(buildUrl(site.tool, param, '..%2f..'))

        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          if (segment === safeValueFor(param)) return
          expect(actual[index]).toBe(segment)
        })
      }
    )
  })
})

/**
 * The env var routes, asserted concretely rather than reflectively. These are
 * the shapes the live probe collapsed: `name` = `..` on the DELETE route
 * re-aims it at `.../envvars`, and `environment` = `..` re-aims it at
 * `.../projects/{ref}`.
 */
describe('trigger.dev env var route shape', () => {
  const base = { apiKey: 'tr_x', projectRef: 'proj_abc', environment: 'dev', value: 'v' }

  const deleteUrl = (overrides: Record<string, unknown>) =>
    new URL(
      (triggerDevTools.triggerDevDeleteEnvVarTool.request.url as (p: any) => string)({
        ...base,
        name: 'MYVAR',
        ...overrides,
      })
    )

  it('addresses the single-variable route for a legitimate name', () => {
    expect(deleteUrl({}).pathname).toBe('/api/v1/projects/proj_abc/envvars/dev/MYVAR')
  })

  it.each(['..', '.'])('refuses to collapse onto the collection route for name %j', (name) => {
    expect(() => deleteUrl({ name })).toThrow(/name/)
  })

  it.each(['..', '.'])('refuses to collapse the environment segment for %j', (environment) => {
    expect(() => deleteUrl({ environment })).toThrow(/environment/)
  })

  it('keeps the PUT update route on the same shape', () => {
    const url = new URL(
      (triggerDevTools.triggerDevUpdateEnvVarTool.request.url as (p: any) => string)({
        ...base,
        name: 'MYVAR',
      })
    )
    expect(url.pathname).toBe('/api/v1/projects/proj_abc/envvars/dev/MYVAR')
  })

  it('keeps the import route suffix intact', () => {
    const url = new URL(
      (triggerDevTools.triggerDevImportEnvVarsTool.request.url as (p: any) => string)({
        ...base,
        variables: [],
      })
    )
    expect(url.pathname).toBe('/api/v1/projects/proj_abc/envvars/dev/import')
  })
})
