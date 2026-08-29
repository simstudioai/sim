/**
 * @vitest-environment node
 *
 * Guards every Attio tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * These IDs are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../objects/people` escape its
 * intended resource once `fetch` normalized the URL, re-aiming the request (and
 * the user's Attio bearer token) at an arbitrary Attio resource — including on
 * DELETE. `assertRequestUrlMatchesTrust` in `tools/request-transport.ts` only
 * applies its canonicalization guard to internal `/api/` routes, so nothing
 * downstream catches this.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * **One param is fuzzed at a time**, with every sibling held at a safe value.
 * Fuzzing all params at once and skipping the vector when the builder throws
 * looks equivalent but is not: as soon as a tool has one guarded param, that
 * param throws first and its unguarded siblings stop being exercised at all.
 * A tool like `attio_get_attribute` carries three path params, so the coarse
 * form would report full coverage while testing exactly one of them. Case
 * discovery below is therefore per **(tool, param)** pair, and each pair gets
 * its own baseline so an unguarded sibling cannot hide behind a guarded one.
 */
import { describe, expect, it } from 'vitest'
import * as attioTools from '@/tools/attio/index'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../objects/people',
  '..%2f..%2fobjects/people',
  'list_abc/../../../objects/people',
  'list_abc?limit=500',
  'list_abc#fragment',
  'list_abc/entries/../../../webhooks',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  'people',
  'companies',
  'deals',
  'objects',
  'lists',
  'sales-pipeline',
  '2e6d8c1a-6a1a-4b2e-9a6f-1c2d3e4f5a6b',
  'user_email_address',
  'example.com',
  'sub.example.co.uk',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

/** Held by every param except the one under test. */
const SIBLING_ID = 'SIBLING'
/** Distinct from `SIBLING_ID` so the param under test is locatable in the path. */
const PROBE_ID = 'PROBEVALUE'

type AnyTool = ToolConfig<any, any>

function isAttioTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('attio_')
  )
}

/**
 * Builds a param object with every declared param at a safe value, then puts
 * `value` on `target` alone. Holding the siblings safe is what keeps a throw
 * from `target` attributable to `target`.
 */
function buildParams(tool: AnyTool, target: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { accessToken: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'accessToken') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array' || type === 'object') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SIBLING_ID
    }
  }
  params[target] = value
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

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

function stringParamNames(tool: AnyTool): string[] {
  return Object.entries(tool.params ?? {})
    .filter(([name]) => name !== 'accessToken')
    .filter(([, def]) => {
      const type = (def as { type?: string }).type
      return type === undefined || type === 'string' || type === 'json'
    })
    .map(([name]) => name)
}

/**
 * Every (tool, param) pair whose value reaches the request **path**, discovered
 * by probing one param at a time rather than declared in a hand-kept list — a
 * new path param is picked up here without anyone editing this file.
 */
const PATH_PARAM_CASES = Object.values(attioTools)
  .filter(isAttioTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    stringParamNames(tool)
      .filter((param) => {
        try {
          return buildPath(tool, param, PROBE_ID).includes(PROBE_ID)
        } catch {
          return false
        }
      })
      .map((param) => ({ name: `${tool.id} / ${param}`, tool, param }))
  )

describe('attio path-ID traversal safety', () => {
  it('covers every (tool, param) pair that reaches a request path', () => {
    expect(PATH_PARAM_CASES.length).toBeGreaterThanOrEqual(43)
  })

  it('exercises every tool that builds a dynamic path', () => {
    const tools = new Set(PATH_PARAM_CASES.map(({ tool }) => tool.id))

    expect(tools.size).toBeGreaterThanOrEqual(31)
  })

  describe.each(PATH_PARAM_CASES)('$name', ({ tool, param }) => {
    const baseline = segmentsOf(buildPath(tool, param, PROBE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let path: string
      try {
        path = buildPath(tool, param, value)
      } catch {
        return
      }

      const actual = segmentsOf(path)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === PROBE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(TRAVERSAL_IDS)('stays on the Attio v2 API with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, param, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.attio.com')
      expect(url.pathname.startsWith('/v2/')).toBe(true)
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildPath(tool, param, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === PROBE_ID ? value : segment)
      })
    })

    it('rejects a bare dot-dot segment by name instead of silently popping a segment', () => {
      expect(() => buildUrl(tool, param, '..')).toThrow(
        new RegExp(`${param}\\b.*path traversal is not allowed`)
      )
    })

    it('rejects a bare dot segment by name', () => {
      expect(() => buildUrl(tool, param, '.')).toThrow(
        new RegExp(`${param}\\b.*path traversal is not allowed`)
      )
    })

    it('rejects a path separator by name', () => {
      expect(() => buildUrl(tool, param, 'list_abc/entries')).toThrow(
        new RegExp(`${param}\\b.*cannot contain a path separator`)
      )
    })

    it('does not let the id inject query parameters', () => {
      const url = buildUrl(tool, param, 'list_abc?limit=500')

      expect(url.searchParams.get('limit')).not.toBe('500')
    })

    it('trims surrounding whitespace rather than encoding it', () => {
      expect(buildPath(tool, param, '  people  ')).toBe(buildPath(tool, param, 'people'))
    })
  })
})
