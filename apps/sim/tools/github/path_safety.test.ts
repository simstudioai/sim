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
import { describe, expect, it } from 'vitest'
import * as githubTools from '@/tools/github/index'
import type { ToolConfig } from '@/tools/types'

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
 * Parameters the provider reads as one path parameter that may itself contain
 * `/` — a namespaced GitHub label such as `area/api`. The separator must
 * survive as `%2F`, so these neither reject it nor promote it to a boundary.
 */
const ENCODED_SEGMENT_PARAMS = new Set(['name'])

const PROBE = 'PROBEVALUE'
const FILLER = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isGitHubTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('github')
  )
}

/**
 * Builds a param object for a tool with one parameter set to `value` and every
 * other string-ish parameter set to a constant, so the assertion isolates the
 * parameter under test.
 *
 * Number-typed parameters are filled with the probe string too. Their declared
 * type is not enforced anywhere between the LLM tool call and the URL builder,
 * so an `issue_number` of `'..'` reaches the path exactly like a string one.
 */
function buildParams(tool: AnyTool, target: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = name === target ? value : FILLER
    }
  }
  return params
}

function buildUrl(tool: AnyTool, target: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, target, value) as any))
}

function buildPath(tool: AnyTool, target: string, value: string): string {
  return buildUrl(tool, target, value).pathname
}

interface PathParamCase {
  name: string
  tool: AnyTool
  param: string
  baseline: string
}

/**
 * Every (tool, parameter) pair whose value actually reaches the URL path,
 * discovered by probing rather than declared, so a new tool is covered the
 * moment it lands in the barrel.
 */
const PATH_PARAM_CASES: PathParamCase[] = []

for (const tool of Object.values(githubTools).filter(isGitHubTool)) {
  if (typeof tool.request?.url !== 'function') continue
  for (const param of Object.keys(tool.params ?? {})) {
    if (param === 'apiKey') continue
    let baseline: string
    try {
      baseline = buildPath(tool, param, PROBE)
    } catch {
      continue
    }
    if (!baseline.includes(PROBE)) continue
    PATH_PARAM_CASES.push({ name: `${tool.id} / ${param}`, tool, param, baseline })
  }
}

describe('github path traversal safety', () => {
  it('covers every GitHub tool parameter that reaches the request path', () => {
    expect(PATH_PARAM_CASES.length).toBeGreaterThanOrEqual(60)
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
