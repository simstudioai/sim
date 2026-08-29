/**
 * @vitest-environment node
 *
 * Guards every Tailscale tool against path traversal through an LLM-writable
 * identifier that gets interpolated into the request path.
 *
 * `tailnet`, `deviceId`, `userId`, and `keyId` are `visibility: 'user-or-llm'`,
 * so prompt injection controls them. Interpolating one raw let a value like
 * `../../users/12345` escape its API prefix once `fetch` normalized the URL,
 * re-aiming the request — and the caller's Tailscale API key — at a different
 * resource, including on the DELETE routes that remove a device or a user.
 *
 * These call sites already wrapped the value in `encodeURIComponent`, and that
 * is precisely why the bare `.` and `..` vectors below are the point of this
 * file. Reverting one guard to `encodeURIComponent(params.deviceId.trim())`
 * turns *only* the `.` and `..` cases red — every slash-bearing vector still
 * passes, because encoding does neutralize a separator. That narrow red band is
 * the whole defect: both dot spellings are made of unreserved characters, so
 * they survive encoding untouched and the URL parser then removes them as dot
 * segments, popping one path segment off a fixed host. An encode-only fix looks
 * correct under any test that omits them.
 *
 * A tailnet is legitimately an organization name (`example.com`), an emailish
 * login name (`user@example.com`), or the literal `-` alias for the caller's
 * default tailnet, so `LEGITIMATE_IDS` pins all three: the guard rejects only a
 * whole-value dot segment, never a dot inside a longer name.
 */
import { describe, expect, it } from 'vitest'
import * as tailscaleTools from '@/tools/tailscale/index'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../users/12345',
  '..%2f..%2fusers/12345',
  'example.com/../../device/nodeid',
  'example.com?fields=all',
  'example.com#fragment',
  'device/../../tailnet/victim.com/acl',
  '\\..\\..',
] as const

/**
 * Every vector the guard must refuse outright, derived from the list above so
 * the two cannot drift apart.
 *
 * A shape assertion alone cannot see the worst of these. `https://host/a/.`
 * normalizes to `https://host/a/`, so a trailing dot segment collapses the id
 * while leaving the segment *count* and every other segment untouched — a
 * shape-only check passes with the guard removed. Most routes here end in the
 * guarded id (`tailscale_delete_device` among them), so that is exactly where a
 * shape-only suite is blindest. Rejection is therefore asserted directly, per
 * parameter, rather than inferred from the resulting path.
 */
const REJECTED_IDS = TRAVERSAL_IDS.filter((value) => {
  const trimmed = value.trim()
  return trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed)
})

/**
 * Values a real Tailscale caller supplies; none may be rejected, and none may
 * reach the wire as a different value. `user@example.com` arrives
 * percent-encoded, which is why the assertion compares the decoded segment —
 * that encoding predates this guard and is not a behaviour change.
 */
const LEGITIMATE_IDS = [
  'example.com',
  'user@example.com',
  '-',
  'corp.ts.net',
  'sub.example.co.uk',
  'nodeIdABC123CNTRL',
  'kABC123CNTRL',
  '123456',
  '..foo',
  'foo..',
] as const

/**
 * Fills the parameter currently under test. Distinct from `SIBLING` so an
 * assertion can tell the fuzzed segment apart from every other one.
 */
const TARGET = 'TARGETSEGMENT'

/** Fills every parameter that is not under test, held constant and safe. */
const SIBLING = 'SIBLINGSEGMENT'

/** Probes which parameter reaches the path, before any vector is applied. */
const PROBE = 'PROBESEGMENT'

const ORIGINS = ['https://api.tailscale.com']

/** The parameter values handed to a tool's URL builder. */
type Fill = Record<string, unknown>

type UrlBuilder = (params: Fill) => string

/** The slice of a tool this harness needs, narrowed from the barrel export. */
interface PathTool {
  id: string
  params: Record<string, { type?: string }>
  buildUrl: UrlBuilder
}

/**
 * One parameter of one tool that lands in the path, plus the sibling values
 * that route the URL builder down the branch where it does.
 */
interface PathParam {
  name: string
  tool: PathTool
  param: string
  context: Fill
}

/**
 * Narrows a barrel export to the tool shape this harness drives.
 *
 * Structural narrowing keeps the harness free of `any`: nothing here needs a
 * tool's parameter or response generics, only its id, its declared parameter
 * types, and a callable URL builder.
 */
function asPathTool(value: unknown): PathTool | null {
  if (typeof value !== 'object' || value === null) return null

  const candidate = value as { id?: unknown; params?: unknown; request?: unknown }
  if (typeof candidate.id !== 'string' || !candidate.id.startsWith('tailscale_')) return null

  const request = candidate.request
  if (typeof request !== 'object' || request === null) return null

  const url = (request as { url?: unknown }).url
  if (typeof url !== 'function') return null

  const params =
    typeof candidate.params === 'object' && candidate.params !== null
      ? (candidate.params as Record<string, { type?: string }>)
      : {}

  return { id: candidate.id, params, buildUrl: url as UrlBuilder }
}

/**
 * Fills every declared parameter with a safe value of the right shape, so the
 * URL builder runs to completion no matter which parameters it reads.
 */
function baseFill(tool: PathTool): Fill {
  const params: Fill = { apiKey: 'token' }
  for (const [name, def] of Object.entries(tool.params)) {
    if (name === 'apiKey') continue
    if (def.type === 'json' || def.type === 'array') {
      params[name] = []
    } else if (def.type === 'number') {
      params[name] = 1
    } else if (def.type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SIBLING
    }
  }
  return params
}

function stringParamsOf(tool: PathTool): string[] {
  return Object.entries(tool.params)
    .filter(([name, def]) => {
      if (name === 'apiKey') return false
      return def.type !== 'json' && def.type !== 'array' && def.type !== 'boolean'
    })
    .map(([name]) => name)
}

/**
 * Harvests the string literals a URL builder compares against, so a branch
 * keyed on a discriminator such as `action === 'unblock'` is explored too.
 *
 * Without this, filling every parameter with one safe value pins each such tool
 * to a single branch, and an identifier that only appears on the other branch —
 * `targetUserId` on the DELETE path, say — is never discovered and never
 * fuzzed. Reading the builder's own source is what keeps that self-maintaining:
 * a new branch value is picked up without editing this file.
 */
function branchLiteralsOf(tool: PathTool): string[] {
  const source = String(tool.buildUrl)
  const found = new Set<string>()
  for (const match of source.matchAll(/['"]([^'"\\\n]{1,24})['"]/g)) {
    const literal = match[1]
    if (!literal || /[/?=.: ]/.test(literal)) continue
    found.add(literal)
  }
  return [...found]
}

function buildUrl(tool: PathTool, fill: Fill): URL {
  return new URL(tool.buildUrl(fill))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

function reachesPath(tool: PathTool, fill: Fill, param: string): boolean {
  try {
    return segmentsOf(buildUrl(tool, { ...fill, [param]: PROBE })).includes(PROBE)
  } catch {
    return false
  }
}

const TOOLS = Object.values(tailscaleTools)
  .map(asPathTool)
  .filter((tool): tool is PathTool => tool !== null)

/**
 * Tools whose URL cannot be built even from all-safe values.
 *
 * Discovery has to tolerate a failed probe, since probing a guarded parameter
 * is expected to throw. That tolerance must not extend to a tool that cannot be
 * exercised at all, because such a tool would drop out of the suite silently
 * and take its path parameters with it — so it is surfaced by name instead.
 */
const UNBUILDABLE = TOOLS.filter((tool) => {
  try {
    buildUrl(tool, baseFill(tool))
    return false
  } catch {
    return true
  }
}).map((tool) => tool.id)

/**
 * Enumerates every (tool, parameter) pair that reaches the request path.
 *
 * Fuzzing one parameter at a time — with every sibling held at a safe value —
 * is what makes a newly added unguarded parameter fail CI. Filling all of them
 * with the same vector cannot: the first guarded parameter throws, the whole
 * case is skipped, and its unguarded siblings are never exercised.
 */
function pathParamsOf(tool: PathTool): PathParam[] {
  const base = baseFill(tool)
  const names = stringParamsOf(tool)
  const literals = branchLiteralsOf(tool)
  const contexts: Fill[] = [base]
  for (const discriminator of names) {
    for (const literal of literals) {
      contexts.push({ ...base, [discriminator]: literal })
    }
  }

  const pairs = new Map<string, PathParam>()
  for (const context of contexts) {
    for (const param of names) {
      if (pairs.has(param)) continue
      if (!reachesPath(tool, context, param)) continue
      pairs.set(param, { name: `${tool.id} / ${param}`, tool, param, context })
    }
  }
  return [...pairs.values()]
}

const PATH_PARAMS: PathParam[] = TOOLS.flatMap(pathParamsOf)

function fuzz({ tool, param, context }: PathParam, value: string | number): URL {
  return buildUrl(tool, { ...context, [param]: value })
}

describe('tailscale path-ID traversal safety', () => {
  it('builds a URL for every Tailscale tool it enumerates', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('covers every Tailscale tool parameter that reaches the request path', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(26)
  })

  it('discovers every identifier of a multi-ID route, not just the first', () => {
    const perTool = new Map<string, number>()
    for (const { tool } of PATH_PARAMS) {
      perTool.set(tool.id, (perTool.get(tool.id) ?? 0) + 1)
    }
    const multiId = [...perTool.values()].filter((count) => count >= 2)

    expect(multiId).toHaveLength(2)
  })

  describe.each(PATH_PARAMS)('$name', (pathParam) => {
    const baseline = segmentsOf(fuzz(pathParam, TARGET))
    const baselineSearch = fuzz(pathParam, TARGET).search

    it('reaches the path under the context it was discovered in', () => {
      expect(baseline).toContain(TARGET)
    })

    it.each(REJECTED_IDS)('rejects %j outright', (value) => {
      expect(() => fuzz(pathParam, value)).toThrow(new RegExp(pathParam.param))
    })

    it('rejects a bare dot, which a shape assertion cannot see in a trailing segment', () => {
      expect(() => fuzz(pathParam, '.')).toThrow(/path traversal/)
    })

    it('rejects a bare dot-dot segment instead of silently popping a segment', () => {
      expect(() => fuzz(pathParam, '..')).toThrow(/path traversal/)
    })

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = fuzz(pathParam, value)
      } catch {
        return
      }

      expect(ORIGINS).toContain(url.origin)

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === TARGET) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(fuzz(pathParam, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === TARGET) {
          expect(decodeURIComponent(actual[index])).toBe(value)
          return
        }
        expect(actual[index]).toBe(segment)
      })
    })

    it('does not let the ID add to or rewrite the query string', () => {
      expect(fuzz(pathParam, 'example.com?fields=all').search).toBe(baselineSearch)
    })
  })
})
