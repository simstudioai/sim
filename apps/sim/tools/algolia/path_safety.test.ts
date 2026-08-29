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
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * `applicationId` is deliberately not in scope: it is `visibility: 'user-only'`
 * and lands in the *host*, not the path, so it is neither LLM-writable nor a
 * dot-segment vector. It is pinned to a fixed value below so the origin
 * assertions stay meaningful.
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
  'products?attributesToRetrieve=*',
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

const SAFE_ID = 'SAFEID'

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
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised. `applicationId` and
 * `apiKey` are pinned: they are credentials, not path identifiers.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { applicationId: APPLICATION_ID, apiKey: 'key' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'applicationId' || name === 'apiKey') continue
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

const DYNAMIC_PATH_TOOLS = Object.values(algoliaTools)
  .filter(isAlgoliaTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildUrl(tool, SAFE_ID).pathname.includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('algolia path-ID traversal safety', () => {
  it('covers every Algolia tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(12)
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

      expect(ALGOLIA_HOSTS).toContain(url.hostname)
      expect(url.pathname.startsWith('/1/indexes')).toBe(true)

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(SAFE_ID)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(TRAVERSAL_IDS.filter((value) => value.trim() === '.' || value.trim() === '..'))(
      'rejects the bare dot segment %j by name instead of popping the prefix',
      (value) => {
        expect(() => buildUrl(tool, value)).toThrow(/indexName|objectID|taskID/)
      }
    )

    it('does not let an ID inject a query parameter', () => {
      const url = buildUrl(tool, 'products?injectedParam=attacker')

      expect(url.searchParams.get('injectedParam')).toBeNull()
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(SAFE_ID, value))
      })
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      const actual = segmentsOf(buildUrl(tool, `  ${SAFE_ID}  `))

      expect(actual).toEqual(baseline)
    })
  })
})

/**
 * An Algolia `objectID` is an arbitrary caller-chosen string, and Algolia's own
 * clients percent-encode it, so a record keyed `products/123` is legitimate and
 * has always worked. `safeAlgoliaObjectId` therefore guards each `/`-delimited
 * piece rather than refusing the separator outright, which would have been a
 * behaviour change for valid input.
 */
const OBJECT_ID_TOOLS = Object.values(algoliaTools)
  .filter(isAlgoliaTool)
  .filter((tool) => Object.hasOwn(tool.params ?? {}, 'objectID'))
  .map((tool) => ({ name: tool.id, tool }))

function buildObjectIdUrl(tool: AnyTool, objectID: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(
    url({
      applicationId: APPLICATION_ID,
      apiKey: 'key',
      indexName: 'products',
      objectID,
      record: {},
      attributes: {},
    } as any)
  )
}

describe.each(OBJECT_ID_TOOLS)('$name objectID path safety', ({ tool }) => {
  it('keeps a slash-bearing object id working as one encoded segment', () => {
    const url = buildObjectIdUrl(tool, 'catalog/sku-123')

    expect(url.pathname).toContain('catalog%2Fsku-123')
    expect(url.pathname.split('/')).toHaveLength(
      buildObjectIdUrl(tool, 'catalogsku123').pathname.split('/').length
    )
  })

  it('rejects a dot segment hidden inside a slash-bearing object id', () => {
    expect(() => buildObjectIdUrl(tool, 'catalog/../../1/keys')).toThrow(/objectID/)
  })

  it('rejects a bare dot-dot object id', () => {
    expect(() => buildObjectIdUrl(tool, '..')).toThrow(/objectID/)
  })

  it('preserves a plain object id verbatim', () => {
    const url = buildObjectIdUrl(tool, 'sku_123-abc')

    expect(url.pathname).toContain('sku_123-abc')
  })
})
