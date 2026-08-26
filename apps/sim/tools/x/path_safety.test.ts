/**
 * @vitest-environment node
 *
 * Guards every X tool that interpolates a parameter into its request path
 * against path traversal.
 *
 * Tweet IDs, user IDs, and usernames are `visibility: 'user-or-llm'`, so
 * prompt injection controls them. A value like `..` pops a path segment once
 * `fetch` normalizes the URL, re-aiming the request and the caller's OAuth
 * token at a sibling endpoint — `DELETE /2/users/<id>/blocking/<target>`
 * collapses to `DELETE /2/users/<id>/blocking`, and `DELETE /2/tweets/<id>`
 * to `DELETE /2/tweets`.
 *
 * The `x_manage_*` tools build their SECOND path segment only on the
 * un-<verb> branch, so `BRANCH_OVERRIDES` drives each one into that branch;
 * without it the probe silently covers half of those guards. The reached
 * parameter list is asserted against an explicit expectation so a parameter
 * dropping out of coverage fails rather than passing quietly.
 *
 * `encodeURIComponent` is NOT a fix on its own: `.` and `..` are unreserved,
 * so they survive encoding untouched and the WHATWG URL parser then removes
 * them as dot segments. Only value rejection works. Every assertion below
 * resolves the built URL through `new URL(...)` — the same normalization
 * `fetch` performs — and compares *segment shape* rather than template text,
 * because `pathname.startsWith(prefix)` stays green after a segment is popped.
 */
import { describe, expect, it } from 'vitest'
import type { ToolConfig } from '@/tools/types'
import * as toolModule from '@/tools/x/index'

type AnyTool = ToolConfig<any, any>

/** Vectors the guard must reject outright; no encoding neutralizes them. */
const REJECTED = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..'] as const

/**
 * Vectors `encodeURIComponent` genuinely does neutralize — `%` and `?` are
 * escaped, so the value stays one inert segment. These must NOT throw, and
 * they are the vectors that reach a *second* path parameter: a rejected value
 * throws at the first guard, masking an unguarded one further along.
 */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Values a real caller supplies; every one must survive byte-identical. */
const LEGITIMATE = ['1234567890123456789', 'jack', 'X_Dev-1', '..foo', 'foo..'] as const

const ID_PREFIX = 'SAFE'
const TOOL_ID_PREFIX = 'x_'

/**
 * `x_manage_*` interpolates its second path parameter only when `action` names
 * the un-<verb> branch. Without these the second guard is never reached.
 */
const BRANCH_OVERRIDES: Record<string, Record<string, unknown>> = {
  x_manage_block: { action: 'unblock' },
  x_manage_follow: { action: 'unfollow' },
  x_manage_mute: { action: 'unmute' },
  x_manage_like: { action: 'unlike' },
  x_manage_retweet: { action: 'unretweet' },
}

/** Every tool whose path carries more than one parameter, stated explicitly. */
const EXPECTED_MULTI_PARAM_TOOLS: Record<string, string[]> = {
  x_delete_bookmark: ['userId', 'tweetId'],
  x_manage_block: ['userId', 'targetUserId'],
  x_manage_follow: ['userId', 'targetUserId'],
  x_manage_mute: ['userId', 'targetUserId'],
  x_manage_like: ['userId', 'tweetId'],
  x_manage_retweet: ['userId', 'tweetId'],
}

function isTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith(TOOL_ID_PREFIX) &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

function markerFor(name: string, _type?: string): string {
  return `${ID_PREFIX}${name}`
}

/**
 * Fills every declared parameter, giving each one a distinct marker so the
 * segment it occupies can be located, applies any per-tool overrides needed to
 * reach a conditional branch, then overrides exactly one parameter with
 * `value` when `poison` names it.
 */
function buildParams(tool: AnyTool, poison?: string, value?: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries<any>(tool.params ?? {})) {
    const type = def.type
    if (type === 'json' || type === 'object') params[name] = {}
    else if (type === 'array') params[name] = []
    else if (type === 'number') params[name] = Number(markerFor(name, type))
    else if (type === 'boolean') params[name] = false
    else params[name] = markerFor(name, type)
  }
  Object.assign(params, BRANCH_OVERRIDES[tool.id] ?? {})
  if (poison !== undefined) params[poison] = value
  return params
}

function buildUrl(tool: AnyTool, poison?: string, value?: string): URL {
  return new URL((tool.request?.url as (p: any) => string)(buildParams(tool, poison, value)))
}

/**
 * The parameters this tool interpolates into the PATH. Classification goes
 * through `new URL(...).pathname`, so query-zone and host-zone parameters are
 * excluded structurally rather than by name.
 */
function pathParamsOf(tool: AnyTool): string[] {
  const pathname = buildUrl(tool).pathname
  return Object.keys(tool.params ?? {}).filter((name) => {
    const def = (tool.params as any)[name]
    return pathname.includes(markerFor(name, def?.type))
  })
}

const PATH_TOOLS = Object.values(toolModule)
  .filter(isTool)
  .map((tool) => ({ name: tool.id, tool, pathParams: pathParamsOf(tool) }))
  .filter((entry) => entry.pathParams.length > 0)

const TOTAL_PATH_PARAMS = PATH_TOOLS.reduce((sum, entry) => sum + entry.pathParams.length, 0)

describe('X path-parameter traversal safety', () => {
  it('covers every tool that interpolates a parameter into its path', () => {
    expect(PATH_TOOLS.length).toBe(23)
    expect(TOTAL_PATH_PARAMS).toBe(29)
  })

  it('reaches both path parameters of every conditional template', () => {
    for (const [id, expected] of Object.entries(EXPECTED_MULTI_PARAM_TOOLS)) {
      const entry = PATH_TOOLS.find((candidate) => candidate.name === id)
      expect(entry, `${id} reached no path parameter at all`).toBeDefined()
      expect([...entry!.pathParams].sort()).toEqual([...expected].sort())
    }
  })

  it('never mistakes the branch selector for a path parameter', () => {
    for (const { pathParams } of PATH_TOOLS) {
      expect(pathParams).not.toContain('action')
    }
  })

  describe.each(PATH_TOOLS)('$name', ({ tool, pathParams }) => {
    const baseline = buildUrl(tool)
    const baselineSegments = baseline.pathname.split('/')

    describe.each(pathParams)('%s', (param) => {
      const slot = baselineSegments.indexOf(markerFor(param, (tool.params as any)[param]?.type))

      it('occupies exactly one path segment in the baseline', () => {
        expect(slot).toBeGreaterThan(0)
      })

      it.each(REJECTED)('rejects %j instead of reshaping the path', (value) => {
        expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
      })

      it.each(NEUTRALIZED)('neutralizes %j into a single inert segment', (value) => {
        const url = buildUrl(tool, param, value)
        const segments = url.pathname.split('/')

        expect(url.origin).toBe(baseline.origin)
        expect(segments).toHaveLength(baselineSegments.length)
        baselineSegments.forEach((segment, index) => {
          if (index === slot) return
          expect(segments[index]).toBe(segment)
        })
        expect(url.searchParams.get('foo')).toBeNull()
      })

      it.each(LEGITIMATE)('passes %j through byte-identical', (value) => {
        const url = buildUrl(tool, param, value)
        const segments = url.pathname.split('/')

        expect(url.origin).toBe(baseline.origin)
        expect(segments).toHaveLength(baselineSegments.length)
        baselineSegments.forEach((segment, index) => {
          expect(index === slot ? decodeURIComponent(segments[index]) : segments[index]).toBe(
            index === slot ? value : segment
          )
        })
      })
    })
  })
})

/**
 * The independence check. Poisoning *every* parameter at once passes even when
 * a second path parameter is unguarded, because the first guard throws before
 * the second is ever reached. Each case below poisons exactly one parameter
 * and leaves every other one legitimate.
 */
describe('X guards every path param independently', () => {
  describe.each(PATH_TOOLS)('$name', ({ tool, pathParams }) => {
    it.each(pathParams)('rejects a bare ".." in %s alone', (param) => {
      expect(() => buildUrl(tool, param, '..')).toThrow(new RegExp(param))
    })

    it.each(pathParams)('keeps the path shape when only %s carries an encoded vector', (param) => {
      const baselineSegments = buildUrl(tool).pathname.split('/')
      const slot = baselineSegments.indexOf(markerFor(param, (tool.params as any)[param]?.type))
      const segments = buildUrl(tool, param, '..%2f..').pathname.split('/')

      expect(segments).toHaveLength(baselineSegments.length)
      baselineSegments.forEach((segment, index) => {
        if (index === slot) return
        expect(segments[index]).toBe(segment)
      })
    })
  })
})
