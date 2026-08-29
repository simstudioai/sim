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

const ORIGIN = 'https://bigquery.googleapis.com'

/** The fixed API prefix every route of this service shares. */
const BASE_PATH = '/bigquery/v2/'

/**
 * BigQuery ids carry interior dots (`project.dataset.table`), hyphens and
 * underscores; none of those may be rejected or rewritten.
 */
const LEGITIMATE_IDS = [
  'my-project-123',
  'bigquery-public-data',
  'analytics_2024',
  'my_dataset.my_table',
  'my-project.my_dataset.my_table',
  'job_aBcDeF-123_456',
] as const

/**
 * Tools whose URL embeds no caller-supplied path segment — static or purely
 * query-string driven. Pinned so a tool cannot silently drop out of coverage.
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
