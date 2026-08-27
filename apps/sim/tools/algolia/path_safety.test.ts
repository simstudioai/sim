/**
 * @vitest-environment node
 *
 * Guards every Algolia tool that interpolates a parameter into its request
 * path against path traversal.
 *
 * The index name and object ID are `visibility: 'user-or-llm'`, so prompt
 * injection controls them. A value of exactly `.` pops nothing but the record:
 * `DELETE /1/indexes/myindex/.` normalizes to `DELETE /1/indexes/myindex`,
 * deleting the whole index instead of one record. A value of exactly `..` pops
 * one segment further — `/1/indexes/myindex/..` becomes `/1/indexes/` — re-aiming
 * the request and the caller's admin API key at the list-indices route. Both were
 * verified through `new URL(...)`; neither is the "delete the index" escalation
 * the other one is, so both are rejected.
 *
 * `applicationId` is deliberately NOT asserted on here: it is interpolated
 * into the HOST (`https://<appId>-dsn.algolia.net`), not the path, and the
 * classification below resolves through `new URL(...).pathname` so host-zone
 * and query-zone parameters drop out structurally.
 *
 * `encodeURIComponent` is NOT a fix on its own: `.` and `..` are unreserved,
 * so they survive encoding untouched and the WHATWG URL parser then removes
 * them as dot segments. Only value rejection works. Every assertion below
 * resolves the built URL through `new URL(...)` — the same normalization
 * `fetch` performs — and compares *segment shape* rather than template text,
 * because `pathname.startsWith(prefix)` stays green after a segment is popped.
 *
 * The vector lists are **per parameter**, because the two path parameters are
 * not treated alike. `objectID` is opaque in Algolia's published sources: the
 * OpenAPI gives it a bare `type: string` with no `pattern` (where `userID` in
 * the same bundled spec carries `^[a-zA-Z0-9 \-*.]+$`, which excludes `/`), the
 * official JS client `encodeURIComponent`s it into the segment, and the client
 * conformance suite round-trips a space on a record id (`Batman and Robin` →
 * `/1/indexes/cts_e2e_browse/Batman%20and%20Robin`) and a literal slash on the
 * rules id (`test/with/slash` → `/1/indexes/indexName/rules/test%2Fwith%2Fslash`).
 * `indexName` is treated as a named resource here — a separator in it means the
 * caller passed the wrong thing — which is a repository choice, not a
 * documented Algolia constraint: the spec gives `indexName` a bare
 * `type: string` too. (A live probe suggested Algolia rejects a slashed
 * `indexName` with `400 indexName is not valid`; that is unverified and
 * unreproduced here, and nothing below rests on it.)
 *
 * A single shared list that contained no `/`-bearing legitimate value is what
 * let a guard rejecting `/` in `objectID` ship green.
 */
import { describe, expect, it } from 'vitest'
import * as toolModule from '@/tools/algolia/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

/**
 * Parameters whose value is an opaque record id rather than a named resource.
 * Algolia treats `objectID` as an arbitrary string — a `/` inside it is a
 * legal, common (URL-keyed) id, not a separator — so it is guarded by
 * collapsing the whole value into one percent-encoded segment instead of
 * rejecting separators.
 */
const OPAQUE_ID_PARAMS = new Set(['objectID'])

/** No encoding scheme neutralizes these; every guard must reject them. */
const DOT_SEGMENT_VECTORS = ['..', '.', '  ..  '] as const

/**
 * Separator-bearing vectors. These are rejected only by parameters that
 * address a *named* resource, where a separator means the caller passed
 * something other than what the parameter addresses. For an opaque id they are
 * legitimate values and appear in {@link OPAQUE_LEGITIMATE} instead.
 */
const SEPARATOR_VECTORS = ['a/../../b', '\\..\\..'] as const

/**
 * Vectors `encodeURIComponent` genuinely does neutralize — `%` and `?` are
 * escaped, so the value stays one inert segment. These must NOT throw, and
 * they are the vectors that reach a *second* path parameter: a rejected value
 * throws at the first guard, masking an unguarded one further along.
 */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Values a real caller supplies; every one must survive byte-identical. */
const LEGITIMATE = [
  'products',
  'my-index.v2',
  'prod-catalog_2024',
  'obj.123-abc',
  '..foo',
  'foo..',
] as const

/**
 * Legitimate ids that only an opaque-id parameter accepts. The URL-keyed form
 * is the common site-search pattern; `Batman and Robin` is lifted from
 * Algolia's own client conformance suite (`/1/indexes/cts_e2e_browse/Batman%20and%20Robin`
 * → 200), which exercises a space rather than a slash — the suite's slash case
 * is the rules id (`test/with/slash` → `.../rules/test%2Fwith%2Fslash`);
 * `a/../../b` and `docs/` are legal ids whose dot and trailing separators must
 * survive as inert `%2F`-joined text rather than be rejected or emitted as real
 * separators.
 */
const OPAQUE_LEGITIMATE = [
  'https://example.com/docs/getting-started',
  'Batman and Robin',
  'foo/bar',
  'a/../../b',
  'docs/',
] as const

function rejectedFor(param: string): readonly string[] {
  return OPAQUE_ID_PARAMS.has(param)
    ? DOT_SEGMENT_VECTORS
    : [...DOT_SEGMENT_VECTORS, ...SEPARATOR_VECTORS]
}

function legitimateFor(param: string): readonly string[] {
  return OPAQUE_ID_PARAMS.has(param) ? [...LEGITIMATE, ...OPAQUE_LEGITIMATE] : LEGITIMATE
}

const ID_PREFIX = 'SAFE'
const TOOL_ID_PREFIX = 'algolia_'

/** No Algolia path template branches on a parameter value. */
const BRANCH_OVERRIDES: Record<string, Record<string, unknown>> = {}

function isTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith(TOOL_ID_PREFIX) &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

/**
 * Number-typed parameters (`algolia_get_task_status`'s `taskID`) reach the
 * guard as a JSON number and are stringified by `toGuardedString`, so they need
 * a numeric marker to be discoverable at all. Skipping them would silently drop
 * a real guard site from coverage.
 */
const NUMBER_MARKERS = new Map<string, string>()

function markerFor(name: string, type?: string): string {
  if (type === 'number') {
    const existing = NUMBER_MARKERS.get(name)
    if (existing) return existing
    const marker = String(9_000_001 + NUMBER_MARKERS.size)
    NUMBER_MARKERS.set(name, marker)
    return marker
  }
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

describe('Algolia path-parameter traversal safety', () => {
  it('covers every tool that interpolates a parameter into its path', () => {
    expect(PATH_TOOLS.length).toBe(13)
    expect(TOTAL_PATH_PARAMS).toBe(18)
  })

  it('classifies the host-zone applicationId out of the path', () => {
    for (const { tool, pathParams } of PATH_TOOLS) {
      expect(pathParams).not.toContain('applicationId')
      expect(buildUrl(tool).hostname).toContain('algolia.net')
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

      it.each(rejectedFor(param))('rejects %j instead of reshaping the path', (value) => {
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

      it.each(legitimateFor(param))('passes %j through byte-identical', (value) => {
        const url = buildUrl(tool, param, value)
        const segments = url.pathname.split('/')

        expect(url.origin).toBe(baseline.origin)
        expect(segments).toHaveLength(baselineSegments.length)
        baselineSegments.forEach((segment, index) => {
          expect(index === slot ? decodeURIComponent(segments[index]) : segments[index]).toBe(
            index === slot ? value : segment
          )
        })

        expect(segments[slot]).toBe(encodeURIComponent(value))

        if (encodeURIComponent(value) === value) {
          expect(segments[slot]).toBe(value)
        }
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
describe('Algolia guards every path param independently', () => {
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

/**
 * Pins the two dot-segment normalizations the guards exist to prevent, through
 * the same `new URL(...)` the `fetch` implementation applies, and shows that the
 * relaxation for opaque ids did not re-open either one.
 *
 * The escalation is asymmetric, which the previous docstring here had backwards:
 * `.` pops only the record segment and leaves the *index* addressed — that is
 * the "delete the whole index" vector on `DELETE /1/indexes/<index>/<objectID>`.
 * `..` pops one further and lands on `/1/indexes/`, re-aiming the admin key at
 * the list/create-index route. Both are rejected; neither is merely encoded.
 */
describe('Algolia dot-segment normalization', () => {
  const RECORD_ROUTE = 'https://app.algolia.net/1/indexes/myindex/'

  it('confirms "." collapses the record route onto the index itself', () => {
    expect(new URL(`${RECORD_ROUTE}.`).pathname).toBe('/1/indexes/myindex/')
  })

  it('confirms ".." pops the index segment too', () => {
    expect(new URL(`${RECORD_ROUTE}..`).pathname).toBe('/1/indexes/')
    expect(encodeURIComponent('..')).toBe('..')
  })

  it('still rejects an exact dot segment in an opaque objectID', () => {
    for (const { tool, pathParams } of PATH_TOOLS) {
      for (const param of pathParams.filter((name) => OPAQUE_ID_PARAMS.has(name))) {
        expect(() => buildUrl(tool, param, '.')).toThrow(new RegExp(param))
        expect(() => buildUrl(tool, param, '..')).toThrow(new RegExp(param))
      }
    }
  })

  it('collapses a slash-bearing opaque objectID into one %2F-joined segment', () => {
    const opaque = PATH_TOOLS.flatMap(({ tool, pathParams }) =>
      pathParams.filter((name) => OPAQUE_ID_PARAMS.has(name)).map((name) => ({ tool, name }))
    )

    expect(opaque.length).toBeGreaterThan(0)

    for (const { tool, name } of opaque) {
      const baselineSegments = buildUrl(tool).pathname.split('/')
      const url = buildUrl(tool, name, 'a/../../b')
      const segments = url.pathname.split('/')
      const slot = baselineSegments.indexOf(markerFor(name, (tool.params as any)[name]?.type))

      expect(segments).toHaveLength(baselineSegments.length)
      expect(segments[slot]).toBe('a%2F..%2F..%2Fb')
      expect(decodeURIComponent(segments[slot])).toBe('a/../../b')
    }
  })
})
