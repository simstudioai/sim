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

const SAFE_ID = 'SAFEID'

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
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
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
      params[name] = value
    }
  }
  return params
}

function buildUrl(tool: AnyTool, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, value) as any))
}

function buildPath(tool: AnyTool, value: string): string {
  return buildUrl(tool, value).pathname
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(attioTools)
  .filter(isAttioTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildPath(tool, SAFE_ID).includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('attio path-ID traversal safety', () => {
  it('covers every Attio tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(30)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildPath(tool, SAFE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let path: string
      try {
        path = buildPath(tool, value)
      } catch {
        return
      }

      const actual = segmentsOf(path)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(TRAVERSAL_IDS)('stays on the Attio v2 API with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.attio.com')
      expect(url.pathname.startsWith('/v2/')).toBe(true)
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildPath(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? value : segment)
      })
    })

    it('rejects a bare dot-dot segment by name instead of silently popping a segment', () => {
      expect(() => buildUrl(tool, '..')).toThrow(/path traversal/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow(/path traversal/)
    })

    it('does not let an id inject query parameters', () => {
      const url = buildUrl(tool, 'list_abc?limit=500')

      expect(url.searchParams.get('limit')).not.toBe('500')
    })

    it('trims surrounding whitespace rather than encoding it', () => {
      expect(buildPath(tool, '  people  ')).toBe(buildPath(tool, 'people'))
    })
  })
})
