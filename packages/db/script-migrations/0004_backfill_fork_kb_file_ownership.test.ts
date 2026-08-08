/**
 * @vitest-environment node
 */
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import {
  assertForkKnowledgeBaseOwnershipFullyReconciled,
  assertForkKnowledgeBaseOwnershipPostDrainAck,
  createPostgresForkKnowledgeBaseOwnershipRepairStore,
  FORK_KB_OWNERSHIP_POST_DRAIN_ACK,
  type ForkKnowledgeBaseOwnershipRepairStore,
  reconcileForkKnowledgeBaseFileOwnership,
} from './0004_backfill_fork_kb_file_ownership'

interface CapturedQuery {
  text: string
  values: unknown[]
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function createSqlHarness(options: {
  candidates?: string[]
  insertedKeys?: string[]
  unresolved?: number
}): { queries: CapturedQuery[]; sql: Sql } {
  const queries: CapturedQuery[] = []
  const query = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?')
    queries.push({ text, values })
    if (text.includes('SELECT d.id')) {
      return Promise.resolve((options.candidates ?? []).map((id) => ({ id })))
    }
    if (text.includes('INSERT INTO workspace_files')) {
      return Promise.resolve((options.insertedKeys ?? []).map((key) => ({ key })))
    }
    if (text.includes('SELECT count(*) AS count')) {
      return Promise.resolve([{ count: options.unresolved ?? 0 }])
    }
    throw new Error(`Unexpected SQL in test: ${text}`)
  })
  const sql = query as unknown as Sql
  sql.begin = vi.fn(async (callback) => callback(sql)) as Sql['begin']
  return { queries, sql }
}

describe('fork knowledge-base ownership reconciliation', () => {
  it('processes bounded keyset pages sequentially and aggregates unresolved rows', async () => {
    const events: string[] = []
    const pageCalls: Array<{ afterId: string; limit: number }> = []
    const repairCalls: string[][] = []
    const pages = new Map([
      ['', ['fork_document_a', 'fork_document_b']],
      ['fork_document_b', ['fork_document_c']],
      ['fork_document_c', []],
    ])
    const store: ForkKnowledgeBaseOwnershipRepairStore = {
      async listCandidateDocumentIds(afterId, limit) {
        events.push(`list:${afterId}`)
        pageCalls.push({ afterId, limit })
        return pages.get(afterId) ?? []
      },
      async repairDocumentIds(documentIds) {
        events.push(`repair:${documentIds.join(',')}`)
        repairCalls.push([...documentIds])
        return documentIds.includes('fork_document_c')
          ? { inserted: 0, unresolved: 1 }
          : { inserted: documentIds.length, unresolved: 0 }
      },
    }

    await expect(reconcileForkKnowledgeBaseFileOwnership(store, { batchSize: 2 })).resolves.toEqual(
      { scanned: 3, inserted: 2, unresolved: 1 }
    )
    expect(pageCalls).toEqual([
      { afterId: '', limit: 2 },
      { afterId: 'fork_document_b', limit: 2 },
      { afterId: 'fork_document_c', limit: 2 },
    ])
    expect(repairCalls).toEqual([['fork_document_a', 'fork_document_b'], ['fork_document_c']])
    expect(events).toEqual([
      'list:',
      'repair:fork_document_a,fork_document_b',
      'list:fork_document_b',
      'repair:fork_document_c',
      'list:fork_document_c',
    ])
  })

  it('rejects oversized and non-advancing store pages', async () => {
    const oversized: ForkKnowledgeBaseOwnershipRepairStore = {
      listCandidateDocumentIds: vi.fn().mockResolvedValue(['a', 'b']),
      repairDocumentIds: vi.fn(),
    }
    await expect(
      reconcileForkKnowledgeBaseFileOwnership(oversized, { batchSize: 1 })
    ).rejects.toThrow('oversized page')

    const nonAdvancing: ForkKnowledgeBaseOwnershipRepairStore = {
      listCandidateDocumentIds: vi.fn().mockResolvedValue(['']),
      repairDocumentIds: vi.fn(),
    }
    await expect(reconcileForkKnowledgeBaseFileOwnership(nonAdvancing)).rejects.toThrow(
      'non-advancing page'
    )
  })

  it('is idempotent after the first run records every uncontested binding', async () => {
    const missing = new Set(['fork_document_a', 'fork_document_b'])
    const store: ForkKnowledgeBaseOwnershipRepairStore = {
      async listCandidateDocumentIds(afterId, limit) {
        return [...missing]
          .filter((id) => id > afterId)
          .sort()
          .slice(0, limit)
      },
      async repairDocumentIds(documentIds) {
        for (const id of documentIds) missing.delete(id)
        return { inserted: documentIds.length, unresolved: 0 }
      },
    }

    await expect(reconcileForkKnowledgeBaseFileOwnership(store)).resolves.toEqual({
      scanned: 2,
      inserted: 2,
      unresolved: 0,
    })
    await expect(reconcileForkKnowledgeBaseFileOwnership(store)).resolves.toEqual({
      scanned: 0,
      inserted: 0,
      unresolved: 0,
    })
  })

  it('selects only active documents with canonical deterministic fork identities', async () => {
    const harness = createSqlHarness({ candidates: ['fork_document_a'] })
    const store = createPostgresForkKnowledgeBaseOwnershipRepairStore(harness.sql)

    await expect(store.listCandidateDocumentIds('fork_document_0', 250)).resolves.toEqual([
      'fork_document_a',
    ])

    const query = harness.queries[0]
    const text = normalizeSql(query.text)
    expect(text).toContain("d.id ~ '^fork_document_[0-9a-f]{40}$'")
    expect(text).toContain("d.storage_key = 'kb/fork-' || d.id")
    expect(text).toContain('d.user_excluded = false')
    expect(text).toContain('d.archived_at IS NULL')
    expect(text).toContain('d.deleted_at IS NULL')
    expect(text).toContain('kb.deleted_at IS NULL')
    expect(text).toContain('kb.workspace_id IS NOT NULL')
    expect(text).toContain("bound.context = 'knowledge-base'")
    expect(text).toContain('bound.workspace_id = kb.workspace_id')
    expect(text).toContain('ORDER BY d.id LIMIT ?')
    expect(query.values).toEqual(['fork_document_0', 250])
  })

  it('inserts only uncontested bindings and reports every still-unbound candidate', async () => {
    const harness = createSqlHarness({
      insertedKeys: ['kb/fork-fork_document_a'],
      unresolved: 1,
    })
    const store = createPostgresForkKnowledgeBaseOwnershipRepairStore(harness.sql)

    await expect(store.repairDocumentIds(['fork_document_a', 'fork_document_b'])).resolves.toEqual({
      inserted: 1,
      unresolved: 1,
    })

    const insert = normalizeSql(harness.queries[0].text)
    expect(insert).toContain('coalesce(d.uploaded_by, kb.user_id)')
    expect(insert).toContain("d.id ~ '^fork_document_[0-9a-f]{40}$'")
    expect(insert).toContain("d.storage_key = 'kb/fork-' || d.id")
    expect(insert).toContain('other_document.storage_key = d.storage_key')
    expect(insert).toContain('other_kb.workspace_id IS DISTINCT FROM kb.workspace_id')
    expect(insert).toContain('active_binding.key = d.storage_key')
    expect(insert).toContain('active_binding.deleted_at IS NULL')
    expect(insert).toContain('ON CONFLICT DO NOTHING RETURNING key')
    expect(harness.queries[0].values).toEqual([['fork_document_a', 'fork_document_b']])

    const remaining = normalizeSql(harness.queries[1].text)
    expect(remaining).toContain("d.id ~ '^fork_document_[0-9a-f]{40}$'")
    expect(remaining).toContain("bound.context = 'knowledge-base'")
    expect(remaining).toContain('bound.workspace_id = kb.workspace_id')
    expect(harness.queries[1].values).toEqual([['fork_document_a', 'fork_document_b']])
  })

  it('requires the post-drain acknowledgement and fails unresolved operator runs', () => {
    expect(() => assertForkKnowledgeBaseOwnershipPostDrainAck(undefined)).toThrow(
      'only after old app instances are drained'
    )
    expect(() =>
      assertForkKnowledgeBaseOwnershipPostDrainAck(FORK_KB_OWNERSHIP_POST_DRAIN_ACK)
    ).not.toThrow()
    expect(() =>
      assertForkKnowledgeBaseOwnershipFullyReconciled({
        scanned: 1,
        inserted: 0,
        unresolved: 1,
      })
    ).toThrow('left 1 conflicting document(s) unresolved')
    expect(() =>
      assertForkKnowledgeBaseOwnershipFullyReconciled({
        scanned: 1,
        inserted: 1,
        unresolved: 0,
      })
    ).not.toThrow()
  })
})
