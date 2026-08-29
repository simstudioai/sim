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
 * file: both are made of unreserved characters, so they survive encoding
 * untouched and the URL parser then removes them as dot segments, popping one
 * path segment off a fixed host. Every assertion resolves the built URL with
 * `new URL(...)` — the same normalization `fetch` performs — rather than
 * string-matching the template output, because string matching is exactly what
 * let this through.
 *
 * A tailnet is legitimately an organization name (`example.com`), an emailish
 * login name (`user@example.com`), or the literal `-` alias for the caller's
 * default tailnet, so `LEGITIMATE_IDS` pins all three: the guard rejects only a
 * whole-value dot segment, never a dot inside a longer name.
 */
import { describe, expect, it } from 'vitest'
import * as tailscaleTools from '@/tools/tailscale/index'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why the
 * pre-existing `encodeURIComponent` looked like a fix while the hole was live.
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
 * Values a real Tailscale caller supplies; none may be rejected, and none may
 * reach the wire as a different value.
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

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isTailscaleTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('tailscale_')
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

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(tailscaleTools)
  .filter(isTailscaleTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return segmentsOf(buildUrl(tool, SAFE_ID)).includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('tailscale path-ID traversal safety', () => {
  it('covers every Tailscale tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(24)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildUrl(tool, SAFE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.tailscale.com')

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) {
          expect(decodeURIComponent(actual[index])).toBe(value)
          return
        }
        expect(actual[index]).toBe(segment)
      })
    })

    it('rejects a bare dot-dot segment instead of silently popping a segment', () => {
      expect(() => buildUrl(tool, '..')).toThrow(/path traversal/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow(/path traversal/)
    })

    it('does not let the ID inject query parameters', () => {
      expect(buildUrl(tool, 'example.com?fields=all').searchParams.get('fields')).toBeNull()
    })
  })
})
