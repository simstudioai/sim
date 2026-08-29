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
 * — the shape this file originally copied — silently stops testing a tool's
 * remaining IDs the moment one of them is guarded, so a route like
 * `/1/indexes/{indexName}/{objectID}` would have been reported as covered while
 * `objectID` was never exercised at all.
 *
 * `applicationId` is deliberately out of scope: it is `visibility: 'user-only'`
 * and lands in the *host*, not the path, so it is neither LLM-writable nor a
 * dot-segment vector. It is pinned below so the host assertions stay
 * meaningful.
 */
import { describe, expect, it } from 'vitest'
import * as algoliaTools from '@/tools/algolia/index'
import type { ToolConfig } from '@/tools/types'

const APPLICATION_ID = 'appid'
const ALGOLIA_HOSTS = [
  `${APPLICATION_ID}.algolia.net`,
  `${APPLICATION_ID}-dsn.algolia.net`,
] as const

/**
 * The bare `.` and `..` entries are the whole point: their omission is why the
 * pre-existing `encodeURIComponent` looked correct while the hole stayed live.
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
  '\\..\\..',
] as const

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

type AnyTool = ToolConfig<any, any>

function isAlgoliaTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('algolia_')
  )
}

/**
 * Builds a param object with `targetName` set to `value` and every other
 * parameter pinned to a known-safe placeholder of the right shape, so a failure
 * is always attributable to the one parameter under test. `applicationId` and
 * `apiKey` are credentials, not path identifiers, and stay fixed.
 */
function buildParams(tool: AnyTool, targetName: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { applicationId: APPLICATION_ID, apiKey: 'key' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'applicationId' || name === 'apiKey') continue
    if (name === targetName) {
      params[name] = value
      continue
    }
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'object') {
      params[name] = {}
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SIBLING
    }
  }
  return params
}

function buildUrl(tool: AnyTool, targetName: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, targetName, value) as any))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/**
 * Every (tool, parameter) pair whose parameter actually reaches the path, found
 * by probing one parameter at a time with a unique marker.
 */
const PATH_PARAM_PAIRS = Object.values(algoliaTools)
  .filter(isAlgoliaTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
      .filter((paramName) => paramName !== 'applicationId' && paramName !== 'apiKey')
      .filter((paramName) => {
        try {
          return buildUrl(tool, paramName, TARGET).pathname.includes(TARGET)
        } catch {
          return false
        }
      })
      .map((paramName) => ({ name: `${tool.id} / ${paramName}`, tool, paramName }))
  )

describe('algolia path-ID traversal safety', () => {
  it('covers every Algolia path parameter, not just the first per tool', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(18)
  })

  it('exercises the second ID of every two-ID route', () => {
    const covered = new Set(PATH_PARAM_PAIRS.map((pair) => pair.name))

    expect(covered).toContain('algolia_add_record / objectID')
    expect(covered).toContain('algolia_get_record / objectID')
    expect(covered).toContain('algolia_delete_record / objectID')
    expect(covered).toContain('algolia_partial_update_record / objectID')
    expect(covered).toContain('algolia_get_task_status / taskID')
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, paramName }) => {
    const baseline = segmentsOf(buildUrl(tool, paramName, TARGET))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, paramName, value)
      } catch (error) {
        expect(String(error)).toContain(paramName)
        return
      }

      expect(ALGOLIA_HOSTS).toContain(url.hostname)
      expect(url.pathname.startsWith('/1/indexes')).toBe(true)
      expect(url.searchParams.get('injectedParam')).toBeNull()

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(TARGET)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(['..', '.', '  ..  '])('rejects the bare dot segment %j by name', (value) => {
      expect(() => buildUrl(tool, paramName, value)).toThrow(new RegExp(paramName))
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, paramName, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(TARGET, value))
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
 * and has always worked. `safeAlgoliaObjectId` therefore guards each
 * `/`-delimited piece rather than refusing the separator outright, which would
 * have been a behaviour change for valid input.
 */
const OBJECT_ID_TOOLS = PATH_PARAM_PAIRS.filter((pair) => pair.paramName === 'objectID')

describe.each(OBJECT_ID_TOOLS)('$name slash-bearing object ids', ({ tool, paramName }) => {
  it('keeps a slash-bearing object id working as one encoded segment', () => {
    const url = buildUrl(tool, paramName, 'catalog/sku-123')

    expect(url.pathname).toContain('catalog%2Fsku-123')
    expect(segmentsOf(url)).toHaveLength(
      segmentsOf(buildUrl(tool, paramName, 'catalogsku123')).length
    )
  })

  it('rejects a dot segment hidden inside a slash-bearing object id', () => {
    expect(() => buildUrl(tool, paramName, 'catalog/../../1/keys')).toThrow(/objectID/)
  })

  it('preserves a plain object id verbatim', () => {
    expect(buildUrl(tool, paramName, 'sku_123-abc').pathname).toContain('sku_123-abc')
  })
})
