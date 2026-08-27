/**
 * @vitest-environment node
 *
 * Guards every Qdrant, Algolia, Box, X, and Spotify tool that interpolates a
 * parameter into its request path against path traversal.
 *
 * Every one of these IDs is `visibility: 'user-or-llm'`, so prompt injection
 * controls it. A value that is exactly `.` or `..` is made of *unreserved*
 * characters, so `encodeURIComponent` returns it verbatim and the WHATWG URL
 * parser then removes it as a dot segment — popping one path segment off a
 * fixed host with the caller's bearer token still attached. Qdrant's
 * `search_vector` was live proof: it wrapped `collection` in
 * `encodeURIComponent` and `collection = '..'` still rewrote
 * `/collections/../points/query` into `/points/query`.
 *
 * Two properties of the assertions below are load-bearing and must not be
 * relaxed:
 *
 * 1. Every check resolves the built URL through `new URL(...)` — the same
 *    normalization `fetch` performs — never string-matching the template.
 * 2. A `pathname.startsWith(prefix)` check ALONE is too weak, because a
 *    one-segment pop still satisfies the prefix. Each vector is therefore
 *    compared against the baseline's full **segment count and fixed-segment
 *    shape**, which is what catches the single-pop case.
 */
import { describe, expect, it } from 'vitest'
import * as algoliaTools from '@/tools/algolia/index'
import * as boxTools from '@/tools/box/index'
import * as qdrantTools from '@/tools/qdrant/index'
import * as spotifyTools from '@/tools/spotify/index'
import type { ToolConfig } from '@/tools/types'
import * as xTools from '@/tools/x/index'

type AnyTool = ToolConfig<any, any>

const SENTINEL = 'ZZSENTINELZZ'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live. No
 * encoding scheme neutralizes an exact dot segment, so these are rejected for
 * EVERY path parameter in this file, opaque ids included. Do not relax them.
 */
const DOT_SEGMENT_VALUES = ['..', '.', '  ..  '] as const

/**
 * Separator-bearing vectors, rejected by every parameter that names a
 * *resource* — where a stray `/` or `\\` means the caller passed something
 * other than what the parameter addresses.
 *
 * They are deliberately NOT applied to {@link OPAQUE_ID_PARAMS}. Keeping them
 * global is what let a false rejection ship green: this file and
 * `algolia/path_safety.test.ts` both encoded "a separator is always hostile"
 * as a universal truth, so neither suite could see a legitimate slashed id
 * being turned away.
 */
const SEPARATOR_VALUES = ['a/../../b', '\\..\\..'] as const

/**
 * Parameters the provider documents as an **opaque string** rather than a
 * named resource, where a `/` is a legal character of the id and not a
 * separator. These are guarded by `safeOpaqueUrlSegment`, which rejects an
 * exact dot segment and then percent-encodes everything else (`/` → `%2F`), so
 * the value still collapses to exactly one inert path segment.
 *
 * Only `objectID` qualifies. Algolia documents no charset for it — the OpenAPI
 * declares a bare `type: string` with no `pattern` while constraining `userID`
 * with one in the same file, its own JS client `encodeURIComponent`s the value
 * into the segment, and the API distinguishes the two cases itself:
 * `/1/indexes/instant%2Fsearch/settings` answers `400 indexName is not valid`
 * while a slashed or URL-shaped objectID answers `404 ObjectID does not exist`,
 * i.e. well-formed but absent. URL-keyed object ids are a common site-search
 * pattern.
 *
 * Every other path parameter in this file was separately verified as unable to
 * contain a slash — Qdrant collection names, Box ids, X snowflakes, Spotify
 * base-62 ids — so widening this set would re-open a real traversal. Add to it
 * only with provider evidence of the same kind.
 */
const OPAQUE_ID_PARAMS = new Set(['objectID'])

/** The vectors a given parameter must reject outright. */
function rejectedValuesFor(param: string): readonly string[] {
  return OPAQUE_ID_PARAMS.has(param)
    ? DOT_SEGMENT_VALUES
    : [...DOT_SEGMENT_VALUES, ...SEPARATOR_VALUES]
}

/**
 * Values the guard neutralizes by encoding rather than rejecting. These must
 * NOT throw, and must still resolve to the baseline path shape.
 */
const NEUTRALIZED_VALUES = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Values a real caller legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_VALUES = [
  'my.collection',
  'my-collection',
  'products.v2',
  '12345678901',
  '1839274659283746501',
  '4uLU6hMCjMI75M1A2tKUQC',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

/** Qdrant's cluster URL is `user-only` and is a HOST, not a path segment. */
const HOST_PARAMS = new Set(['url', 'applicationId'])

function isTargetTool(value: unknown): value is AnyTool {
  const tool = value as AnyTool
  return (
    typeof tool === 'object' &&
    tool !== null &&
    typeof tool.id === 'string' &&
    typeof tool.request?.url === 'function'
  )
}

/**
 * Fills every declared string param, setting `target` to `value` and every
 * other one to a neutral filler, so exactly one param is under test.
 */
function buildParams(
  tool: AnyTool,
  target: string,
  value: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') params[name] = []
    else if (type === 'number') params[name] = name === target ? value : 1
    else if (type === 'boolean') params[name] = false
    else if (name === target) params[name] = value
    else params[name] = name === 'url' ? 'https://cluster.example.com' : `filler${name}`
  }
  return { ...params, ...overrides, [target]: value }
}

function buildUrl(
  tool: AnyTool,
  target: string,
  value: string,
  overrides: Record<string, unknown> = {}
): URL {
  return new URL(
    (tool.request!.url as (p: any) => string)(buildParams(tool, target, value, overrides))
  )
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/**
 * Reflectively finds every `(tool, param)` pair whose value lands in the PATH
 * zone — classified by resolving a unique sentinel and checking it appears in
 * the resolved `pathname`, never by grepping the template.
 */
function pathZonePairs(namespace: Record<string, unknown>, prefix: string) {
  const pairs: Array<{ name: string; param: string; tool: AnyTool }> = []
  for (const value of Object.values(namespace)) {
    if (!isTargetTool(value)) continue
    const tool = value
    if (!tool.id.startsWith(prefix)) continue
    for (const [param, def] of Object.entries(tool.params ?? {})) {
      const type = (def as { type?: string }).type
      if (type && type !== 'string' && type !== 'number') continue
      if (HOST_PARAMS.has(param)) continue
      let url: URL
      try {
        url = buildUrl(tool, param, SENTINEL)
      } catch {
        continue
      }
      if (!url.pathname.includes(SENTINEL)) continue
      pairs.push({ name: `${tool.id} [${param}]`, param, tool })
    }
  }
  return pairs
}

const SUITES = [
  { service: 'qdrant', pairs: pathZonePairs(qdrantTools, 'qdrant_'), pathParamCount: 3 },
  { service: 'algolia', pairs: pathZonePairs(algoliaTools, 'algolia_'), pathParamCount: 18 },
  { service: 'box', pairs: pathZonePairs(boxTools, 'box_'), pathParamCount: 7 },
  { service: 'x', pairs: pathZonePairs(xTools, 'x_'), pathParamCount: 24 },
  { service: 'spotify', pairs: pathZonePairs(spotifyTools, 'spotify_'), pathParamCount: 24 },
] as const

describe.each(SUITES)(
  '$service path-parameter traversal safety',
  ({ service, pairs, pathParamCount }) => {
    it(`enumerates every ${service} path parameter`, () => {
      expect(pairs.length).toBe(pathParamCount)
    })

    describe.each(pairs)('$name', ({ tool, param }) => {
      const baselineUrl = buildUrl(tool, param, SENTINEL)
      const baseline = segmentsOf(baselineUrl)

      it.each(rejectedValuesFor(param))('rejects %j outright', (value) => {
        expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
      })

      it.each(NEUTRALIZED_VALUES)('neutralizes %j without reshaping the path', (value) => {
        const url = buildUrl(tool, param, value)
        const actual = segmentsOf(url)

        expect(url.origin).toBe(baselineUrl.origin)
        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          if (segment === SENTINEL) return
          expect(actual[index]).toBe(segment)
        })
        expect(url.searchParams.get('foo')).toBeNull()
      })

      it.each(LEGITIMATE_VALUES)('passes %j through byte-identically', (value) => {
        const actual = segmentsOf(buildUrl(tool, param, value))

        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment === SENTINEL ? value : segment)
        })
      })
    })
  }
)

/**
 * Poisoning every param at once masks an unguarded second one: the first
 * guard throws before the second is ever reached. These cases hold every
 * other param legitimate and attack exactly one.
 */
const INDEPENDENT_PARAM_CASES: ReadonlyArray<{
  id: string
  ns: Record<string, unknown>
  params: readonly string[]
  /** Values that steer a branching `url()` down the multi-segment path. */
  overrides?: Record<string, unknown>
}> = [
  { ns: boxTools, id: 'box_copy_file', params: ['fileId'] },
  { ns: boxTools, id: 'box_delete_folder', params: ['folderId'] },
  { ns: boxTools, id: 'box_list_folder_items', params: ['folderId'] },
  { ns: xTools, id: 'x_delete_bookmark', params: ['userId', 'tweetId'] },
  {
    ns: xTools,
    id: 'x_manage_like',
    params: ['userId', 'tweetId'],
    overrides: { action: 'unlike' },
  },
  {
    ns: xTools,
    id: 'x_manage_retweet',
    params: ['userId', 'tweetId'],
    overrides: { action: 'unretweet' },
  },
  {
    ns: xTools,
    id: 'x_manage_block',
    params: ['userId', 'targetUserId'],
    overrides: { action: 'unblock' },
  },
  {
    ns: xTools,
    id: 'x_manage_follow',
    params: ['userId', 'targetUserId'],
    overrides: { action: 'unfollow' },
  },
  {
    ns: xTools,
    id: 'x_manage_mute',
    params: ['userId', 'targetUserId'],
    overrides: { action: 'unmute' },
  },
  { ns: algoliaTools, id: 'algolia_delete_record', params: ['indexName', 'objectID'] },
  { ns: algoliaTools, id: 'algolia_get_task_status', params: ['indexName', 'taskID'] },
  { ns: algoliaTools, id: 'algolia_add_record', params: ['indexName', 'objectID'] },
  { ns: spotifyTools, id: 'spotify_remove_tracks_from_playlist', params: ['playlistId'] },
]

function toolById(namespace: Record<string, unknown>, id: string): AnyTool {
  const found = Object.values(namespace).find((v) => isTargetTool(v) && v.id === id)
  if (!found) throw new Error(`tool ${id} not found`)
  return found as AnyTool
}

describe('guards every path param independently', () => {
  for (const testCase of INDEPENDENT_PARAM_CASES) {
    const tool = toolById(testCase.ns, testCase.id)
    const overrides = testCase.overrides ?? {}
    const pathParams = testCase.params.filter((param) => {
      try {
        return buildUrl(tool, param, SENTINEL, overrides).pathname.includes(SENTINEL)
      } catch {
        return false
      }
    })

    it(`${testCase.id} reaches every listed param through its path`, () => {
      expect(pathParams).toEqual([...testCase.params])
    })

    for (const param of testCase.params) {
      it(`${testCase.id} rejects ".." in ${param} while every other param is legitimate`, () => {
        expect(() => buildUrl(tool, param, '..', overrides)).toThrow(new RegExp(param))
      })
    }
  }
})

/**
 * The regression that motivated this file. `search_vector` wrapped `collection`
 * in `encodeURIComponent`, which LOOKS guarded: the path still starts with
 * `/collections/`. It is not — `'..'` pops that very segment, leaving
 * `/points/query` at the cluster root. Prefix checks alone pass; segment-count
 * and shape checks are what fail.
 */
describe('qdrant collection cannot escape /collections/<name>/', () => {
  const QDRANT_TOOLS = pathZonePairs(qdrantTools, 'qdrant_')

  it.each(QDRANT_TOOLS)(
    '$name rejects a bare dot-dot instead of popping /collections/',
    ({ tool, param }) => {
      expect(() => buildUrl(tool, param, '..')).toThrow(/collection/)
    }
  )

  it.each(QDRANT_TOOLS)('$name keeps the collection segment present for %#', ({ tool, param }) => {
    const url = buildUrl(tool, param, 'my.collection')
    const segments = segmentsOf(url)
    const index = segments.indexOf('collections')

    expect(index).toBeGreaterThanOrEqual(0)
    expect(segments[index + 1]).toBe('my.collection')
    expect(segments[index + 2]).toBe('points')
  })
})

/**
 * Pins the opaque-id split as a narrowing for exactly ONE parameter rather than
 * a general loosening, so a later edit cannot quietly widen it.
 *
 * The failure this file exists to catch is not just an unguarded parameter — it
 * is a vector list that stops describing reality. Both halves are asserted
 * structurally: every path parameter still rejects dot segments, and every path
 * parameter except `objectID` still rejects separators.
 */
describe('the opaque-id carve-out stays narrow', () => {
  const ALL_PATH_PARAMS = SUITES.flatMap(({ service, pairs }) =>
    pairs.map(({ name, param, tool }) => ({ service, name, param, tool }))
  )

  it('relaxes separators for objectID and no other parameter', () => {
    const relaxed = [
      ...new Set(
        ALL_PATH_PARAMS.filter(({ param }) => OPAQUE_ID_PARAMS.has(param)).map(
          (entry) => entry.param
        )
      ),
    ]

    expect(relaxed).toEqual(['objectID'])
    expect([...OPAQUE_ID_PARAMS]).toEqual(['objectID'])
  })

  it('keeps the separator vectors on every non-opaque path parameter', () => {
    const strict = ALL_PATH_PARAMS.filter(({ param }) => !OPAQUE_ID_PARAMS.has(param))

    expect(strict.length).toBeGreaterThan(0)
    for (const { param } of strict) {
      expect(rejectedValuesFor(param)).toEqual([...DOT_SEGMENT_VALUES, ...SEPARATOR_VALUES])
    }
  })

  it('leaves all five services with separator coverage', () => {
    for (const { service, pairs } of SUITES) {
      const strict = pairs.filter(({ param }) => !OPAQUE_ID_PARAMS.has(param))
      expect(`${service}:${strict.length > 0}`).toBe(`${service}:true`)
      for (const { tool, param } of strict) {
        for (const value of SEPARATOR_VALUES) {
          expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
        }
      }
    }
  })

  it('keeps the dot-segment vectors on every path parameter, opaque included', () => {
    for (const { tool, param } of ALL_PATH_PARAMS) {
      expect(rejectedValuesFor(param)).toEqual(expect.arrayContaining([...DOT_SEGMENT_VALUES]))
      for (const value of DOT_SEGMENT_VALUES) {
        expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
      }
    }
  })

  it('accepts a slashed objectID as one %2F-joined segment', () => {
    const opaque = ALL_PATH_PARAMS.filter(({ param }) => OPAQUE_ID_PARAMS.has(param))

    expect(opaque.length).toBeGreaterThan(0)
    for (const { tool, param } of opaque) {
      const baseline = segmentsOf(buildUrl(tool, param, SENTINEL))
      const slot = baseline.indexOf(SENTINEL)
      const value = 'https://example.com/docs/getting-started'
      const actual = segmentsOf(buildUrl(tool, param, value))

      expect(slot).toBeGreaterThanOrEqual(0)
      expect(actual).toHaveLength(baseline.length)
      expect(actual[slot]).toBe(encodeURIComponent(value))
      expect(decodeURIComponent(actual[slot])).toBe(value)
    }
  })
})
