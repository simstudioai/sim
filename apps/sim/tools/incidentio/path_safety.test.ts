/**
 * @vitest-environment node
 *
 * Guards every incident.io tool against path traversal through an LLM-writable
 * ID that gets interpolated into the request path.
 *
 * These IDs are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../v2/incidents/victim` escape its
 * API prefix once `fetch` normalized the URL, re-aiming the request (and the
 * user's incident.io bearer token) at an arbitrary incident.io resource —
 * including on the DELETE routes for schedules, workflows, custom fields, and
 * incident roles. `assertRequestUrlMatchesTrust` in `tools/request-transport.ts`
 * only applies its canonicalization guard to internal `/api/` routes, so
 * nothing downstream catches this.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * The unit under test is a **(tool, parameter) pair**, not a tool. Fuzzing every
 * string parameter of a tool at once hides siblings: the first guarded parameter
 * throws, the `catch` swallows the whole vector, and every remaining parameter on
 * that tool goes unexercised — so a tool that already has one guard stops
 * reporting on the ones it is missing. Each parameter is therefore fuzzed alone,
 * with every sibling pinned to a safe value. The pairs are discovered by probing
 * rather than listed by hand, so a new tool — or a new path parameter on an
 * existing tool — joins the matrix on arrival.
 */

import { getErrorMessage } from '@sim/utils/errors'
import { describe, expect, it } from 'vitest'
import * as incidentioTools from '@/tools/incidentio/index'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../v2/incidents/01FCNDV6P870EA6S7TK1DSYDG0',
  '..%2f..%2fv2/incidents/01FCNDV6P870EA6S7TK1DSYDG0',
  '01FCNDV6P870EA6S7TK1DSYDG0/../../../v2/schedules',
  '01FCNDV6P870EA6S7TK1DSYDG0?page_size=100',
  '01FCNDV6P870EA6S7TK1DSYDG0#fragment',
  '01FCNDV6P870EA6S7TK1DSYDG0/actions/../../../v3/catalog_types',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  '01FCNDV6P870EA6S7TK1DSYDG0',
  '01HB5T3XK9WZ8Q2N4MJ7VYRPD6',
  '01G0M0KFHXQXCEE1DVZ7YXQY5T',
  'ABC123',
  'incident-role-primary',
  'my_custom_field',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

/** Pinned into every sibling parameter so only the fuzzed one can move. */
const SIBLING_ID = 'SIBLINGID'

/** Distinguishes the fuzzed parameter's slots from every other path segment. */
const TARGET_ID = 'TARGETID'

const PADDED_ID = '01FCNDV6P870EA6S7TK1DSYDG0'

/**
 * The structural slice of a `ToolConfig` this harness needs.
 *
 * Declared locally rather than reusing `ToolConfig<P, R>`, because the harness
 * deliberately calls `request.url` with a synthetic bag of fuzz values that does
 * not satisfy any tool's concrete params type. Naming that shape here is what
 * lets the call stay type-checked instead of being cast through `any`.
 */
interface FuzzableTool {
  id: string
  params?: Record<string, { type?: string }>
  request?: { url?: string | ((params: Record<string, unknown>) => string) }
}

function isIncidentioTool(value: unknown): value is FuzzableTool {
  if (typeof value !== 'object' || value === null) return false
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.startsWith('incidentio_')
}

/**
 * Builds a param object for a tool, pinning every declared string param to
 * `SIBLING_ID` except `target`, which carries the value under test.
 */
function buildParams(tool: FuzzableTool, target: string, value: string): Record<string, unknown> {
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
      params[name] = name === target ? value : SIBLING_ID
    }
  }
  return params
}

function buildUrl(tool: FuzzableTool, target: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, target, value)))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/**
 * Discovers every (tool, parameter) pair whose parameter reaches the path, by
 * marking one parameter at a time and checking whether the marker survives into
 * `pathname`. Probing rather than listing is what makes a newly added path
 * parameter fail this suite without anyone remembering to register it.
 */
const CANDIDATE_TOOLS = Object.values(incidentioTools)
  .map((value): unknown => value)
  .filter(isIncidentioTool)
  .filter((tool) => typeof tool.request?.url === 'function')

/**
 * Tools and parameters the probe could not evaluate, surfaced as a test failure
 * rather than dropped.
 *
 * A swallowed error here is the same class of bug as the swallowed error in the
 * per-vector assertions: a tool whose URL cannot be built from all-safe values
 * would quietly leave the matrix and read as "nothing to guard".
 */
const DISCOVERY_FAILURES: string[] = []

/** No parameter can be named this, so every parameter stays at its safe value. */
const NO_TARGET = '\u0000none'

const PATH_PARAM_PAIRS = CANDIDATE_TOOLS.flatMap((tool) => {
  try {
    buildUrl(tool, NO_TARGET, SIBLING_ID)
  } catch (error) {
    DISCOVERY_FAILURES.push(`${tool.id}: ${getErrorMessage(error)}`)
    return []
  }

  return Object.keys(tool.params ?? {})
    .filter((name) => name !== 'apiKey')
    .filter((name) => {
      try {
        return buildUrl(tool, name, TARGET_ID).pathname.includes(TARGET_ID)
      } catch (error) {
        DISCOVERY_FAILURES.push(`${tool.id} / ${name}: ${getErrorMessage(error)}`)
        return false
      }
    })
    .map((param) => ({ name: `${tool.id} / ${param}`, tool, param }))
})

describe('incident.io path-parameter traversal safety', () => {
  it('builds every candidate tool URL from safe values, so none is skipped silently', () => {
    expect(DISCOVERY_FAILURES).toEqual([])
  })

  it('covers every (tool, parameter) pair that reaches the request path', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(30)
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, param }) => {
    const baseline = segmentsOf(buildUrl(tool, param, TARGET_ID))

    it('reaches the path in at least one segment', () => {
      expect(baseline).toContain(TARGET_ID)
    })

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, param, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.incident.io')

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === TARGET_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, param, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === TARGET_ID ? value : segment)
      })
    })

    it('rejects a bare dot-dot segment, naming the offending parameter', () => {
      expect(() => buildUrl(tool, param, '..')).toThrow(new RegExp(param))
    })

    it('rejects a bare dot segment, naming the offending parameter', () => {
      expect(() => buildUrl(tool, param, '.')).toThrow(new RegExp(param))
    })

    it('trims surrounding whitespace without altering the id', () => {
      const padded = segmentsOf(buildUrl(tool, param, `  ${PADDED_ID}  `))

      expect(padded).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(padded[index]).toBe(segment === TARGET_ID ? PADDED_ID : segment)
      })
    })

    it('does not let the id inject query parameters', () => {
      const url = buildUrl(tool, param, `${PADDED_ID}?page_size=100`)

      expect(url.searchParams.get('page_size')).not.toBe('100')
    })
  })
})
