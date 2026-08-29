/**
 * @vitest-environment node
 *
 * Guards every Rootly tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * Incident, alert, action-item, and workflow IDs are `visibility: 'user-or-llm'`,
 * so prompt injection controls them. Interpolating one raw let a value like
 * `../../users/victim` escape its API prefix once `fetch` normalized the URL,
 * re-aiming the request — and the workspace's Rootly bearer token — at an
 * arbitrary Rootly resource, including on DELETE.
 * `assertRequestUrlMatchesTrust` in `tools/request-transport.ts` only applies
 * its canonicalization guard to internal `/api/` routes, so nothing downstream
 * catches this.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * The suite enumerates the tool barrel and then, per tool, every declared
 * parameter that reaches a path segment, fuzzing **one parameter at a time**
 * while the others hold a safe value. A new tool — or a new ID parameter on an
 * existing tool — is therefore covered without anyone remembering to register
 * it, and a still-guarded sibling parameter cannot mask an unguarded one by
 * throwing first.
 */
import { describe, expect, it } from 'vitest'
import * as rootlyTools from '@/tools/rootly/index'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../users/victim',
  '..%2f..%2fusers/victim',
  '123/../../../users/victim',
  '123?injectedProbe=attacker',
  '123#fragment',
  '123/events/../../../workflows',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  '4f1c2b3a-5d6e-4f70-8a91-b2c3d4e5f607',
  '00000000-0000-4000-8000-000000000000',
  '12345',
  'INC-42',
  'incident_abc123',
  'v1.2.3',
  '..foo',
  'foo..',
] as const

const SAFE_ID = 'SAFEID'

/** Sentinel for the one parameter under test, so its slots are identifiable. */
const PROBE_ID = 'PROBEID'

const BASE_ORIGIN = 'https://api.rootly.com'

/** Supplied by the platform, never by the model. */
const FIXED_PARAMS: Record<string, unknown> = { apiKey: 'token' }

type AnyTool = ToolConfig<any, any>

function isRootlyTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('rootly_')
  )
}

/**
 * Fills every declared parameter with a type-appropriate safe value, then
 * overrides the single parameter under test.
 */
function buildParams(tool: AnyTool, paramName: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SAFE_ID
    }
  }
  Object.assign(params, FIXED_PARAMS)
  params[paramName] = value
  return params
}

function buildUrl(tool: AnyTool, paramName: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, paramName, value) as any))
}

function segmentsOf(tool: AnyTool, paramName: string, value: string): string[] {
  return buildUrl(tool, paramName, value).pathname.split('/')
}

/** Every (tool, parameter) pair whose value lands in a URL path segment. */
const PATH_PARAMS = Object.values(rootlyTools)
  .filter(isRootlyTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
      .filter((name) => !(name in FIXED_PARAMS))
      .filter((name) => {
        try {
          return buildUrl(tool, name, PROBE_ID).pathname.includes(PROBE_ID)
        } catch {
          return false
        }
      })
      .map((name) => ({ label: `${tool.id} :: ${name}`, tool, paramName: name }))
  )

describe('rootly path-ID traversal safety', () => {
  it('covers every Rootly parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(23)
  })

  describe.each(PATH_PARAMS)('$label', ({ tool, paramName }) => {
    const baseline = segmentsOf(tool, paramName, PROBE_ID)

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, paramName, value)
      } catch {
        return
      }

      expect(url.origin).toBe(BASE_ORIGIN)

      const actual = url.pathname.split('/')
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(PROBE_ID)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(['..', '.'] as const)('rejects the bare %j segment by name', (value) => {
      expect(() => buildUrl(tool, paramName, value)).toThrow(new RegExp(paramName))
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(tool, paramName, value)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.split(PROBE_ID).join(value))
      })
    })

    it('trims surrounding whitespace without altering the id', () => {
      expect(segmentsOf(tool, paramName, `  ${PROBE_ID}  `)).toEqual(baseline)
    })

    it('does not let the id inject a query parameter', () => {
      const url = buildUrl(tool, paramName, `${PROBE_ID}?injectedProbe=attacker`)

      expect(url.searchParams.get('injectedProbe')).toBeNull()
    })
  })
})
