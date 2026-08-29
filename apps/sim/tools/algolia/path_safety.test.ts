/**
 * @vitest-environment node
 *
 * Guards every Algolia tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * `indexName`, `objectID`, and `taskID` are all `visibility: 'user-or-llm'`, so
 * prompt injection controls them. They were already wrapped in
 * `encodeURIComponent`, and that is exactly the trap this file exists to close:
 * `.` and `..` are *unreserved* characters, so they survive encoding untouched
 * and the URL parser then removes them as dot segments. An `indexName` of `..`
 * turned `/1/indexes/../<op>` into `/1/indexes` on a fixed host with the
 * workspace's Algolia admin key attached — and `delete_index`, `delete_record`
 * and `clear_records` are destructive.
 *
 * `applicationId` is deliberately out of scope: it is `visibility: 'user-only'`
 * and lands in the *host*, not the path, so it is neither LLM-writable nor a
 * dot-segment vector. It is pinned below so the host assertions stay
 * meaningful.
 *
 * These call sites are the clearest demonstration in the whole change that
 * encoding is not a fix: with the pre-existing `encodeURIComponent` restored,
 * `algolia_delete_index` and `algolia_delete_record` fail precisely — and only
 * — on the bare `.` and `..` vectors, passing every multi-segment escape,
 * encoded separator and backslash vector, because encoding genuinely does
 * neutralize those.
 *
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * **The suite enumerates (tool, parameter) pairs and fuzzes exactly one
 * parameter at a time**, holding every sibling at a known-safe value. Filling
 * every string parameter with the same hostile value and swallowing the throw
 * silently stops testing a tool's remaining IDs the moment one of them is
 * guarded, so a route like
 * `/1/indexes/{indexName}/{objectID}`
 * would be reported as covered while the second ID was never exercised.
 *
 * **Every pair asserts rejection, not merely that the path keeps its shape.**
 * A shape check cannot see a bare `.` in the *final* segment: a URL ending
 * `/a/.` normalizes to `/a/`, which has the same segment count and the same
 * leading segments as `/a/id`. `delete_index`, `delete_record` and `get_record` all end in a guarded ID and
 * are all destructive, so a shape-only assertion would be at its weakest
 * exactly where the damage is worst. The first test below pins that property of
 * the URL parser so the reason this file asserts `toThrow` stays visible.
 */
import { getErrorMessage } from '@sim/utils/errors'
import { describe, expect, it } from 'vitest'
import * as algoliaTools from '@/tools/algolia/index'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../1/keys',
  '..%2f..%2f1/keys',
  'products/../../../1/keys',
  'products?injectedParam=attacker',
  'products#fragment',
  'products/settings/../../../1/keys',
  '\\\\..\\\\..',
] as const

/** The dot segments, split out because they must be asserted as rejections. */
const DOT_SEGMENTS = ['..', '.', '  ..  '] as const

/**
 * Values a real user legitimately supplies. Algolia index names permit letters,
 * digits, `-`, `_`, `.` and spaces, and none of them may be rejected or
 * altered.
 */
const LEGITIMATE_IDS = [
  'products',
  'products_prod',
  'products-staging',
  'products_v1.2',
  'my_index-2026',
  '..foo',
  'foo..',
] as const

/** The value under test; unique so its position in the path is unambiguous. */
const TARGET = 'TARGETID'

/** Every other string parameter is pinned here so only one variable moves. */
const SIBLING = 'SIBLINGID'

const APPLICATION_ID = 'appid'
const ALGOLIA_HOSTS = [
  `${APPLICATION_ID}.algolia.net`,
  `${APPLICATION_ID}-dsn.algolia.net`,
] as const

/** Credentials, not path identifiers; pinned so only one variable moves. */
const CREDENTIAL_PARAMS: readonly string[] = ['applicationId', 'apiKey']

/**
 * The shared shape every path-safety harness in this batch uses. Parameterizing
 * `ToolConfig` with `Record<string, unknown>` — rather than the fully-untyped
 * parameterization these harnesses were originally copied from — is what lets
 * `url(...)` be called below with no cast at all. `ALL_EXPORTS` is seeded as
 * `readonly unknown[]` so the type guard is the single narrowing point: a
 * barrel's element union is not assignable to a widened `ToolConfig`, because
 * the param type sits in the contravariant position of `request.url`.
 */
type PathTool = ToolConfig<Record<string, unknown>, ToolResponse>

function isProbeableTool(value: unknown): value is PathTool {
  if (typeof value !== 'object' || value === null) return false
  /** Narrowing a validated object for property reads; never `any`. */
  const candidate = value as Record<string, unknown>
  const request = candidate.request
  return (
    typeof candidate.id === 'string' &&
    candidate.id.startsWith('algolia_') &&
    typeof candidate.params === 'object' &&
    candidate.params !== null &&
    typeof request === 'object' &&
    request !== null &&
    'url' in request
  )
}

/**
 * Builds a param object with `targetName` set to `value` and every other
 * parameter pinned to a known-safe placeholder of the right shape, so a failure
 * is always attributable to the one parameter under test. `applicationId` and `apiKey`
 * are credentials, not path identifiers, and stay fixed.
 */
function buildParams(tool: PathTool, targetName: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { applicationId: APPLICATION_ID, apiKey: 'key' }
  for (const [name, def] of Object.entries(tool.params)) {
    if (CREDENTIAL_PARAMS.includes(name)) continue
    if (name === targetName) {
      params[name] = value
      continue
    }
    if (def.type === 'json' || def.type === 'array') {
      params[name] = []
    } else if (def.type === 'object') {
      params[name] = {}
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

function buildUrl(tool: PathTool, targetName: string, value: string): URL {
  const builder = tool.request.url
  if (typeof builder !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(builder(buildParams(tool, targetName, value)))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/**
 * What a guarded parameter must emit into its slot: the trimmed value,
 * percent-encoded, occupying exactly ONE path segment.
 *
 * Asserting this rather than skipping the ID's segment is load-bearing. A skip
 * only proves the segment *count* and the surrounding segments are unchanged,
 * and a traversal can satisfy both: against raw interpolation
 * `matter123/../../matters/victim` resolves `/v1/matters/<id>` to
 * `/v1/matters/victim` — same length, identical non-ID segments, request
 * silently re-aimed at another resource. The escape the file header calls out
 * by name would have slipped through this suite's own canonical vector.
 */
function expectedSegment(value: string): string {
  return encodeURIComponent(value.trim())
}

interface PathParamPair {
  name: string
  tool: PathTool
  paramName: string
}

const ALL_EXPORTS: readonly unknown[] = Object.values(algoliaTools)
const TOOLS: PathTool[] = ALL_EXPORTS.filter(isProbeableTool)

/** Tools whose URL is a constant string; they have no path parameter to fuzz. */
const STATIC_URL_TOOLS: string[] = TOOLS.filter(
  (tool) => typeof tool.request.url !== 'function'
).map((tool) => tool.id)

/**
 * Probes that threw while being built from entirely safe placeholder values.
 * Surfaced rather than swallowed: a tool dropped here is a tool this suite is
 * silently not testing, which is the failure mode the whole file exists to
 * prevent.
 */
const PROBE_FAILURES: Array<{ tool: string; param: string; reason: string }> = []

const PATH_PARAM_PAIRS: PathParamPair[] = []
for (const tool of TOOLS) {
  if (typeof tool.request.url !== 'function') continue
  for (const paramName of Object.keys(tool.params)) {
    if (CREDENTIAL_PARAMS.includes(paramName)) continue
    try {
      if (buildUrl(tool, paramName, TARGET).pathname.includes(TARGET)) {
        PATH_PARAM_PAIRS.push({ name: `${tool.id} / ${paramName}`, tool, paramName })
      }
    } catch (error) {
      PROBE_FAILURES.push({
        tool: tool.id,
        param: paramName,
        reason: getErrorMessage(error),
      })
    }
  }
}

describe('algolia path-ID traversal safety', () => {
  it('a trailing dot segment is invisible to a shape check, so rejection is asserted', () => {
    const withId = new URL(`https://appid.algolia.net/a/b/id`)
    const withDot = new URL(`https://appid.algolia.net/a/b/.`)

    expect(segmentsOf(withDot)).toHaveLength(segmentsOf(withId).length)
    expect(withDot.pathname).toBe('/a/b/')
  })

  it('builds every probe from safe placeholders without dropping a tool', () => {
    expect(PROBE_FAILURES).toEqual([])
    expect(STATIC_URL_TOOLS).toEqual([])
  })

  it('covers every path parameter, not just the first per tool', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(18)
  })

  it('exercises the second ID of every multi-ID route', () => {
    const covered = new Set(PATH_PARAM_PAIRS.map((pair) => pair.name))

    expect(covered).toContain('algolia_add_record / objectID')
    expect(covered).toContain('algolia_get_record / objectID')
    expect(covered).toContain('algolia_delete_record / objectID')
    expect(covered).toContain('algolia_partial_update_record / objectID')
    expect(covered).toContain('algolia_get_task_status / taskID')
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, paramName }) => {
    const baseline = segmentsOf(buildUrl(tool, paramName, TARGET))

    it.each(DOT_SEGMENTS)('rejects the dot segment %j by name', (value) => {
      expect(() => buildUrl(tool, paramName, value)).toThrow(new RegExp(paramName))
    })

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, paramName, value)
      } catch (error) {
        expect(getErrorMessage(error)).toContain(paramName)
        return
      }

      expect(ALGOLIA_HOSTS).toContain(url.hostname)
      expect(url.pathname.startsWith('/1/indexes')).toBe(true)
      expect(url.searchParams.get('injectedParam')).toBeNull()

      const encoded = expectedSegment(value)
      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(TARGET, encoded))
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const encoded = expectedSegment(value)
      const actual = segmentsOf(buildUrl(tool, paramName, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(TARGET, encoded))
        expect(decodeURIComponent(actual[index])).toBe(segment.replaceAll(TARGET, value))
      })
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      expect(segmentsOf(buildUrl(tool, paramName, `  ${TARGET}  `))).toEqual(baseline)
    })
  })
})

/**
 * An Algolia `objectID` is an arbitrary caller-chosen string, and Algolia's own
 * clients percent-encode it, so a record keyed `catalog/sku-123` is legitimate
 * and has always worked. `safeAlgoliaObjectId` therefore encodes a
 * separator-bearing id whole rather than refusing the separator, which would
 * have been a behaviour change for valid input.
 *
 * It does NOT guard the pieces individually, and must not: percent-encoding
 * collapses the value into a single path segment and the URL parser never
 * decodes `%2F`, so no interior piece is ever a path segment that dot-segment
 * removal could act on. Splitting and guarding per piece would buy no safety
 * and would silently corrupt real ids — `safeUrlPathSegment` trims each piece
 * (rewriting `catalog/ sku`) and rejects empty ones (refusing `catalog//sku`).
 * The cases below pin both halves of that: interior dot pieces stay intact, and
 * only a whole-value dot segment is rejected.
 */
const OBJECT_ID_PAIRS = PATH_PARAM_PAIRS.filter((pair) => pair.paramName === 'objectID')

describe.each(OBJECT_ID_PAIRS)('$name separator-bearing object ids', ({ tool, paramName }) => {
  it.each([
    ['catalog/sku-123', 'catalog%2Fsku-123'],
    ['catalog/ sku', 'catalog%2F%20sku'],
    ['catalog//sku', 'catalog%2F%2Fsku'],
    ['catalog/.', 'catalog%2F.'],
    ['catalog/..', 'catalog%2F..'],
    ['catalog/../../1/keys', 'catalog%2F..%2F..%2F1%2Fkeys'],
    ['./sku', '.%2Fsku'],
    ['../sku', '..%2Fsku'],
  ])(
    'keeps %j as the single segment %j, byte-identical to the prior encoding',
    (value, encoded) => {
      const url = buildUrl(tool, paramName, value)

      expect(url.pathname).toContain(encoded)
      expect(encoded).toBe(encodeURIComponent(value.trim()))
      expect(segmentsOf(url)).toHaveLength(segmentsOf(buildUrl(tool, paramName, 'plain')).length)
    }
  )

  it('encodes a backslash-bearing object id instead of rejecting it', () => {
    const value = `catalog${String.fromCharCode(92)}sku`

    expect(buildUrl(tool, paramName, value).pathname).toContain('catalog%5Csku')
  })

  it.each(['..', '.', '  ..  '])('still rejects the whole-value dot segment %j', (value) => {
    expect(() => buildUrl(tool, paramName, value)).toThrow(/objectID/)
  })

  it('preserves a plain object id verbatim', () => {
    expect(buildUrl(tool, paramName, 'sku_123-abc').pathname).toContain('sku_123-abc')
  })
})
