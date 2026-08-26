/**
 * @vitest-environment node
 *
 * Guards every Spotify tool that interpolates a parameter into its request
 * path against path traversal.
 *
 * Playlist, album, artist, show, episode, audiobook, track, and user IDs are
 * `visibility: 'user-or-llm'`, so prompt injection controls them. A value like
 * `..` pops a path segment once `fetch` normalizes the URL, re-aiming the
 * request and the caller's OAuth token at a sibling endpoint — a
 * `DELETE /v1/playlists/<id>/tracks` degrades into a call against
 * `/v1/playlists`, and `PUT /v1/playlists/<id>/followers` into one against
 * the collection.
 *
 * The `spotify:track:...` URI forms never reach a path: they travel in the
 * request body or the query string, which the classification below confirms
 * rather than assumes.
 *
 * `encodeURIComponent` is NOT a fix on its own: `.` and `..` are unreserved,
 * so they survive encoding untouched and the WHATWG URL parser then removes
 * them as dot segments. Only value rejection works. Every assertion below
 * resolves the built URL through `new URL(...)` — the same normalization
 * `fetch` performs — and compares *segment shape* rather than template text,
 * because `pathname.startsWith(prefix)` stays green after a segment is popped.
 */
import { describe, expect, it } from 'vitest'
import * as toolModule from '@/tools/spotify/index'
import type { ToolConfig } from '@/tools/types'

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
const LEGITIMATE = [
  '3n3Ppam7vgaVa1iaRUc9Lp',
  '6rqhFgbbKwnb9MLmUQDhG6',
  '31w4c3xhtnnvcxaqvbszdywoi',
  '..foo',
  'foo..',
] as const

const ID_PREFIX = 'SAFE'
const TOOL_ID_PREFIX = 'spotify_'

/** No Spotify path template branches on a parameter value. */
const BRANCH_OVERRIDES: Record<string, Record<string, unknown>> = {}

/** Parameters that carry `spotify:` URI forms; none of them may reach a path. */
const URI_PARAMS = ['uri', 'uris', 'context_uri'] as const

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

describe('Spotify path-parameter traversal safety', () => {
  it('covers every tool that interpolates a parameter into its path', () => {
    expect(PATH_TOOLS.length).toBe(24)
    expect(TOTAL_PATH_PARAMS).toBe(24)
  })

  it('routes every path parameter through a plain id, never a spotify: URI', () => {
    for (const { pathParams } of PATH_TOOLS) {
      for (const uriParam of URI_PARAMS) {
        expect(pathParams).not.toContain(uriParam)
      }
      for (const param of pathParams) {
        expect(param).toMatch(/Id$/)
      }
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
describe('Spotify guards every path param independently', () => {
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
