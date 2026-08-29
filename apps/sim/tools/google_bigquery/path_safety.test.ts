/**
 * @vitest-environment node
 *
 * Guards every BigQuery tool against path traversal through the LLM-writable
 * `projectId`, `datasetId`, `tableId` and `jobId`.
 *
 * These were wrapped in `encodeURIComponent`, which neutralizes a `/` but not a
 * dot segment: `encodeURIComponent('..') === '..'`, so a `datasetId` of `..`
 * popped `/datasets` off `/bigquery/v2/projects/p/datasets/../tables` and
 * re-aimed a DELETE at a different BigQuery endpoint.
 */
import { describe, expect, it } from 'vitest'
import {
  discoverPathParams,
  itPassesLegitimateValues,
  itResistsTraversal,
  toolsWithoutPathParams,
} from '@/tools/__tests__/path-safety'
import * as bigQueryTools from '@/tools/google_bigquery/index'
import { canonicalBigQueryId } from '@/tools/google_bigquery/utils'

const ORIGIN = 'https://bigquery.googleapis.com'

/** The fixed API prefix every route of this service shares. */
const BASE_PATH = '/bigquery/v2/'

/**
 * Values legitimate for **every** BigQuery path parameter, since the harness
 * applies each one to each parameter in turn.
 *
 * Deliberately no dotted forms. A fully-qualified `project.dataset.table` is
 * BigQuery's *SQL* syntax and appears in the `query` string, never in a path
 * segment — no path parameter here accepts a dot, so listing one as a
 * "legitimate id" would assert support that does not exist and would fight any
 * future per-identifier format validation.
 *
 * The property those values were really covering — that a dot *inside* a
 * segment is preserved rather than treated as traversal — belongs to the guard,
 * not to this service, and is already pinned on it directly in
 * `tools/url-path.test.ts` (`'..foo'`, `'foo..'`).
 */
const LEGITIMATE_IDS = [
  'my-project-123',
  'bigquery-public-data',
  'analytics_2024',
  'job_aBcDeF-123_456',
] as const

/**
 * Every tool contributing no path parameter, pinned exactly so none can leave
 * coverage unnoticed. Each entry is one of: a static or query-string-only URL,
 * a `url` declared as a constant string, or an `InternalToolConfig` whose URL is
 * built in `lib/internal/**` and is therefore out of this suite's reach.
 */
const STATIC_URL_TOOLS = []

const { covered: PATH_PARAMS, unbuildable: UNBUILDABLE } = discoverPathParams(
  bigQueryTools,
  'google_bigquery_'
)

describe('bigquery path-id traversal safety', () => {
  it('builds a URL for every tool in the barrel', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('leaves only genuinely static-URL tools without a path parameter', () => {
    expect(toolsWithoutPathParams(bigQueryTools, 'google_bigquery_')).toEqual(STATIC_URL_TOOLS)
  })

  it('covers every parameter that reaches a URL path segment', () => {
    expect(PATH_PARAMS.length).toBeGreaterThanOrEqual(23)
  })

  describe.each(PATH_PARAMS)('$label', (param) => {
    itResistsTraversal(param, { origin: ORIGIN, basePath: BASE_PATH })
    itPassesLegitimateValues(param, { values: LEGITIMATE_IDS })
  })
})

/**
 * The URL and the request body must name the **same** project.
 *
 * `safeUrlPathSegment` trims before encoding, so guarding the path introduced a
 * divergence that the previous `encodeURIComponent(params.projectId)` did not
 * have: the URL addressed the trimmed project while the body still carried the
 * padded string. `datasetId` and `tableId` were already `.trim()`-ed in these
 * bodies, so `projectId` was the one identifier out of step.
 *
 * BigQuery resolves `defaultDataset` and `tableReference` from the body, so a
 * mismatch either 404s or, worse, names a project the path does not — which is
 * precisely the kind of split-brain reference these guards exist to prevent.
 */
describe('projectId agrees between URL and body', () => {
  const BODY_TOOLS = [
    { name: 'google_bigquery_query', tool: bigQueryTools.googleBigQueryQueryTool },
    { name: 'google_bigquery_create_table', tool: bigQueryTools.googleBigQueryCreateTableTool },
    { name: 'google_bigquery_create_dataset', tool: bigQueryTools.googleBigQueryCreateDatasetTool },
  ]

  /**
   * `safeUrlPathSegment` accepts a finite number or a bigint, because an LLM
   * tool call can serialize a numeric-looking id as a JSON **number**. A bare
   * `.trim()` in the body does not, so the path built fine while the body threw
   * a raw `TypeError` — the request died after passing its own guard.
   */
  it.each(BODY_TOOLS)('$name builds from a numeric project id', ({ tool }) => {
    const params = {
      accessToken: 't',
      projectId: 123456,
      datasetId: 'my_dataset',
      defaultDatasetId: 'my_dataset',
      tableId: 'my_table',
      query: 'SELECT 1',
      schema: '[{"name":"id","type":"STRING"}]',
    }

    const url = new URL((tool.request?.url as (p: typeof params) => string)(params))
    const body = (tool.request?.body as ((p: typeof params) => unknown) | undefined)?.(params)

    expect(url.pathname).toContain('/projects/123456')
    const serialized = JSON.stringify(body)
    if (serialized?.includes('projectId')) {
      expect(serialized).toContain('"projectId":"123456"')
    }
  })

  it.each(BODY_TOOLS)('$name sends one project id', ({ tool }) => {
    const params = {
      accessToken: 't',
      projectId: '  my-project  ',
      datasetId: 'my_dataset',
      defaultDatasetId: 'my_dataset',
      tableId: 'my_table',
      query: 'SELECT 1',
      schema: '[{"name":"id","type":"STRING"}]',
    }

    const url = new URL((tool.request?.url as (p: typeof params) => string)(params))
    const body = (tool.request?.body as ((p: typeof params) => unknown) | undefined)?.(params)
    const serialized = JSON.stringify(body)

    expect(url.pathname).toContain('/projects/my-project/')
    expect(serialized).not.toContain('  my-project  ')
    if (serialized?.includes('projectId')) {
      expect(serialized).toContain('"projectId":"my-project"')
    }
  })
})

/**
 * `canonicalBigQueryId` round-trips through the path guard and undoes only the
 * percent-encoding. These assertions pin the two properties that makes it safe
 * to use for a JSON body: the round-trip is **exact identity** even for values
 * containing `%` or `+`, and every rejection is inherited from the guard rather
 * than restated here.
 */
describe('canonicalBigQueryId', () => {
  it.each(['a%2Fb', 'a+b', 'a b', 'проект', 'a-b_c.d', 'bigquery-public-data'])(
    'returns %j unchanged',
    (value) => {
      expect(canonicalBigQueryId(value, 'projectId')).toBe(value)
    }
  )

  it('trims the way the path guard does', () => {
    expect(canonicalBigQueryId('  my-project  ', 'projectId')).toBe('my-project')
  })

  it('accepts a numeric id, which a bare trim would throw on', () => {
    expect(canonicalBigQueryId(123456, 'projectId')).toBe('123456')
  })

  it('accepts a bigint id, which a bare trim would throw on', () => {
    expect(canonicalBigQueryId(9007199254740991n, 'projectId')).toBe('9007199254740991')
  })

  it.each(['..', '.', 'a/b', 'a\\b'])('inherits the guard rejection of %j', (value) => {
    expect(() => canonicalBigQueryId(value, 'projectId')).toThrow(/projectId/)
  })
})
