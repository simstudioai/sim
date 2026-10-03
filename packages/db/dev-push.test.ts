import * as schema from '@sim/db/schema'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import { describe, expect, it, vi } from 'vitest'

interface SnapshotTable {
  indexes: Record<string, { method: string; with?: Record<string, unknown> }>
}

describe('dev push index options', () => {
  it('matches introspected options without changing ordinary migration snapshots', async () => {
    vi.stubEnv('SIM_DEV_DB_PUSH', undefined)
    const ordinary = generateDrizzleJson(schema)
    const introspected = structuredClone(ordinary)
    const hnswIndexes = Object.values<SnapshotTable>(introspected.tables).flatMap((table) =>
      Object.values(table.indexes).filter((index) => index.method === 'hnsw')
    )
    expect(hnswIndexes.length).toBeGreaterThan(0)
    for (const index of hnswIndexes) {
      expect(index.with).toEqual({ m: 16, ef_construction: 64 })
      index.with = { m: '16', ef_construction: '64' }
    }

    vi.stubEnv('SIM_DEV_DB_PUSH', '1')
    const dev = generateDrizzleJson(schema)
    expect(await generateMigration(introspected, dev)).toEqual([])
    expect({ ...dev, id: ordinary.id }).toEqual(introspected)

    vi.stubEnv('SIM_DEV_DB_PUSH', undefined)
    const restored = generateDrizzleJson(schema)
    expect({ ...restored, id: ordinary.id }).toEqual(ordinary)
  })

  it('still detects a real index-option change in dev', async () => {
    vi.stubEnv('SIM_DEV_DB_PUSH', '1')
    const current = generateDrizzleJson(schema)
    const previous = structuredClone(current)
    previous.tables['public.embedding_search'].indexes.embedding_search_cosine_hnsw_idx.with = {
      m: '8',
      ef_construction: '64',
    }
    const statements = await generateMigration(previous, current)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('DROP INDEX "embedding_search_cosine_hnsw_idx"')
    expect(statements[1]).toContain('WITH (m=16,ef_construction=64)')
  })
})
