/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type MaintenanceDatabase,
  planMaintenance,
  REINDEX_TARGETS,
  runMaintenance,
} from '@/scripts/dormant-org-search/maintenance'

const INDEX_TABLES: Record<string, string> = {
  embedding_search_512_cosine_hnsw_idx: 'embedding_search',
  embedding_search_acl_unfilled_idx: 'embedding_search',
  embedding_keyword_search_content_idx: 'embedding_keyword_search',
  emb_content_fts_idx: 'embedding',
  embedding_search_document_lookup_idx: 'embedding_search',
  embedding_search_cosine_hnsw_idx: 'embedding_search',
  user_pkey: 'user',
}

function fakeDatabase(leftovers: Record<string, string[]> = {}) {
  const ran: string[] = []
  const database: MaintenanceDatabase = {
    report: async () => ({}),
    indexTable: async (index) => INDEX_TABLES[index] ?? null,
    invalidReindexLeftovers: async (index) => leftovers[index] ?? [],
    run: async (statement) => {
      ran.push(statement)
    },
  }
  return { database, ran }
}

describe('planMaintenance', () => {
  it('reports only when no action is requested', () => {
    expect(planMaintenance({})).toEqual({
      action: { kind: 'report' },
      settings: [],
      statements: [],
    })
  })

  it('reindexes every listed index concurrently, without lock or statement timeouts', () => {
    const plan = planMaintenance({ reindex: 'all', maintenanceWorkMem: '2GB', parallelWorkers: 4 })
    expect(plan.statements).toEqual(
      REINDEX_TARGETS.map((name) => `REINDEX INDEX CONCURRENTLY ${name}`)
    )
    expect(plan.settings).toEqual([
      'SET lock_timeout = 0',
      'SET statement_timeout = 0',
      "SET maintenance_work_mem = '2GB'",
      'SET max_parallel_maintenance_workers = 4',
    ])
  })

  it('refuses malformed names, tables outside the allowlist and malformed memory settings', () => {
    expect(() => planMaintenance({ reindex: 'idx; DROP TABLE x' })).toThrow('Not an index name')
    expect(() => planMaintenance({ vacuum: 'user; DROP TABLE x' })).toThrow(
      'Not a maintenance table'
    )
    expect(() => planMaintenance({ vacuum: 'embedding', maintenanceWorkMem: "1GB'; --" })).toThrow(
      'maintenance-work-mem'
    )
    expect(() => planMaintenance({ reindex: 'all', vacuum: 'embedding' })).toThrow('not both')
  })

  it('vacuums exactly one table', () => {
    expect(planMaintenance({ vacuum: 'embedding_search' }).statements).toEqual([
      'VACUUM (VERBOSE, ANALYZE) embedding_search',
    ])
  })
})

describe('runMaintenance', () => {
  it('refuses an index outside the maintenance tables before running anything', async () => {
    const { database, ran } = fakeDatabase()
    for (const index of ['user_pkey', 'missing_idx']) {
      await expect(
        runMaintenance(database, planMaintenance({ reindex: index }), { execute: true })
      ).rejects.toThrow('Not a maintenance index')
    }
    expect(ran).toEqual([])
  })

  it('accepts another index of a maintenance table by name', async () => {
    const { database, ran } = fakeDatabase()
    await runMaintenance(
      database,
      planMaintenance({ reindex: 'embedding_search_cosine_hnsw_idx' }),
      {
        execute: true,
      }
    )
    expect(ran.at(-1)).toBe('REINDEX INDEX CONCURRENTLY embedding_search_cosine_hnsw_idx')
  })

  it('runs nothing in a dry run', async () => {
    const { database, ran } = fakeDatabase()
    await runMaintenance(database, planMaintenance({ reindex: 'all' }), { execute: false })
    expect(ran).toEqual([])
  })

  it('drops an interrupted reindex leftover before rebuilding that index', async () => {
    const { database, ran } = fakeDatabase({
      embedding_search_512_cosine_hnsw_idx: ['embedding_search_512_cosine_hnsw_idx_ccnew'],
    })
    await runMaintenance(
      database,
      planMaintenance({ reindex: 'embedding_search_512_cosine_hnsw_idx' }),
      { execute: true }
    )
    expect(ran).toEqual([
      'SET lock_timeout = 0',
      'SET statement_timeout = 0',
      'DROP INDEX CONCURRENTLY IF EXISTS embedding_search_512_cosine_hnsw_idx_ccnew',
      'REINDEX INDEX CONCURRENTLY embedding_search_512_cosine_hnsw_idx',
    ])
  })
})
