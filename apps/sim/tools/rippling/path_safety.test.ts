/**
 * @vitest-environment node
 *
 * Guards every Rippling tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * These IDs are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../users/victim` escape the
 * resource collection it addresses once `fetch` normalized the URL, re-aiming
 * the request (and the workspace's Rippling bearer token) at an arbitrary
 * Rippling resource — including on DELETE.
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
import * as ripplingTools from '@/tools/rippling/index'
import type { ToolConfig } from '@/tools/types'

const API_ORIGIN = 'https://rest.ripplingapis.com'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looked correct while the hole was live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../users/victim-user',
  '..%2f..%2fusers/victim-user',
  'user_abc/../../../workers',
  'user_abc?expand=secrets',
  'user_abc#fragment',
  'user_abc/records/../../../custom-objects',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  'de4d4d4b-3ab4-4f7f-a1d3-6f2f4dd0d0aa',
  '0b91d2b1c4e94f2a9d3f5c7e8a1b2c3d',
  'A1B2C3D4E5F6',
  'custom_object_api_name',
  'employee_certifications',
  'externalId-2026-01',
  'field.api.name',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isRipplingTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('rippling_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
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

const DYNAMIC_PATH_TOOLS = Object.values(ripplingTools)
  .filter(isRipplingTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildPath(tool, SAFE_ID).includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('rippling path-ID traversal safety', () => {
  it('covers every Rippling tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(40)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildPath(tool, SAFE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe(API_ORIGIN)

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildPath(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? value : segment)
      })
    })

    it('rejects a bare dot-dot segment instead of silently popping the prefix', () => {
      expect(() => buildUrl(tool, '..')).toThrow(/path traversal/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow(/path traversal/)
    })

    it('does not let the id inject a query parameter', () => {
      expect(buildUrl(tool, `${SAFE_ID}?expand=secrets`).searchParams.get('expand')).not.toBe(
        'secrets'
      )
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      expect(buildPath(tool, `  ${SAFE_ID}  `)).toBe(buildPath(tool, SAFE_ID))
    })
  })
})
