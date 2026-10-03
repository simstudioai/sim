import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { readHubSpotMcp, searchHubSpotMcp } from '@/lib/sim-search/live/hubspot-mcp'
import { createManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'

/**
 * Read-only real HubSpot acceptance using the current member grant. Run from apps/sim:
 * SEARCH_HUBSPOT_CASES_PATH=/private/cases.json SEARCH_HUBSPOT_REPORT_PATH=/private/report.json
 * bun --env-file=.env scripts/test-search-hubspot-live.ts
 * Cases contain organizationId, userId, credentialId and queries: [{name, query, kind,
 * expectedIds, filters?}]. Expectations come from independently inspected CRM records; include
 * at least one positive case. Keep private inputs and reports outside the repository.
 * Exercises member credentials and provider transport, not browser authentication or model
 * query selection. No remote records are created or changed.
 */
const logger = createLogger('SearchHubSpotLive')
const reportPath = process.env.SEARCH_HUBSPOT_REPORT_PATH
const casesPath = process.env.SEARCH_HUBSPOT_CASES_PATH
assert(reportPath && casesPath, 'Set SEARCH_HUBSPOT_REPORT_PATH and SEARCH_HUBSPOT_CASES_PATH')
const config = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    credentialId: z.string().min(1),
    queries: z
      .array(
        z.object({
          name: z.string().min(1),
          query: z.string().max(200),
          kind: z.enum(['contacts', 'companies', 'deals', 'tickets']),
          expectedIds: z.array(z.string().regex(/^[1-9]\d*$/)),
          filters: z
            .object({
              startDate: z.iso.datetime().optional(),
              endDate: z.iso.datetime().optional(),
              sortBy: z.enum(['newest', 'oldest']).optional(),
            })
            .optional(),
        })
      )
      .min(2)
      .max(20),
  })
  .parse(JSON.parse(await readFile(casesPath, 'utf8')))
assert(
  config.queries.some((test) => test.expectedIds.length),
  'A positive record fixture is required'
)
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
  }
}
const client = () =>
  createManagedSearchMcpClient(
    { organizationId: config.organizationId },
    config.userId,
    config.credentialId,
    'hubspot',
    AbortSignal.timeout(30_000),
    4
  )
const ids = (documents: { id: string }[]) =>
  documents.map((document) => document.id.split(':').at(-1)!).sort()
for (const test of config.queries) {
  await check(test.name, async () => {
    const provider = await client()
    try {
      const input = {
        query: test.query,
        native: { provider: 'hubspot' as const, query: test.query, kind: test.kind },
        filters: test.filters,
        scopes: [],
        limit: 25,
      }
      const result = await searchHubSpotMcp(provider, input)
      assert(
        !result.partial && !result.nextCursor && !result.hasMore,
        'Fixture must fit one complete page'
      )
      assert.deepEqual(
        ids(result.documents),
        [...test.expectedIds].sort(),
        'Exact CRM record identity differs'
      )
      for (const document of result.documents) {
        assert(document.url && document.content, 'Result must include source evidence')
        if (test.filters?.startDate)
          assert(
            Date.parse(document.modifiedAt!) >= Date.parse(test.filters.startDate),
            'Record precedes lower bound'
          )
        if (test.filters?.endDate)
          assert(
            Date.parse(document.modifiedAt!) < Date.parse(test.filters.endDate),
            'Record exceeds exclusive upper bound'
          )
      }
      if (test.filters?.sortBy) {
        const dates = result.documents.map((document) => Date.parse(document.modifiedAt!))
        assert(dates.every(Number.isFinite), 'Sorted records must include valid modification dates')
        assert.deepEqual(
          dates,
          [...dates].sort((a, b) => (test.filters?.sortBy === 'oldest' ? a - b : b - a))
        )
      }
      if (result.documents.length) {
        const read = await readHubSpotMcp(provider, result.documents[0].id)
        assert.equal(read.id, result.documents[0].id)
        assert.equal(new URL(read.url).pathname, new URL(result.documents[0].url).pathname)
        assert(
          read.content.includes('hs_object_id:'),
          'Read must include returned record properties'
        )
      }
      if (result.documents.length > 1) {
        const first = await searchHubSpotMcp(provider, { ...input, limit: 1 })
        assert(first.nextCursor, 'First page must advertise continuation')
        const second = await searchHubSpotMcp(provider, {
          ...input,
          limit: 1,
          native: { ...input.native, cursor: first.nextCursor },
        })
        assert.deepEqual(
          ids([...first.documents, ...second.documents]),
          ids(result.documents.slice(0, 2))
        )
        if (result.documents.length === 2)
          assert.equal(second.nextCursor, undefined, 'Final page must terminate')
      }
    } finally {
      await provider.close()
    }
  })
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(
  reportPath,
  JSON.stringify({ boundary: 'real HubSpot member grant and provider API', checks }, null, 2),
  { mode: 0o600 }
)
const failed = checks.filter((check) => check.status === 'failed')
logger.info('HubSpot acceptance complete', {
  checks: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
})
process.exit(failed.length ? 1 : 0)
