/** @vitest-environment node */
import { readFile } from 'node:fs/promises'
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))
vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({
  dbFor: () => {
    if (!database.current) throw new Error('Postgres test is not initialized')
    return database.current
  },
  db: {
    select: (...args: unknown[]) => {
      if (!database.current) throw new Error('Postgres test is not initialized')
      return Reflect.apply(database.current.select, database.current, args)
    },
    transaction: (...args: unknown[]) => {
      if (!database.current) throw new Error('Postgres test is not initialized')
      return Reflect.apply(database.current.transaction, database.current, args)
    },
  },
}))
vi.mock('@/lib/core/config/env', () => ({ env: { ENCRYPTION_KEY: 'ef'.repeat(32) } }))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: async () => 'write',
  permissionSatisfies: () => true,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'user-1',
  }),
}))

import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import {
  appendMemoryUseCase,
  deleteMemoryUseCase,
  listMemoriesUseCase,
  readMemoryUseCase,
} from '@/lib/memory/application/use-cases'
import { readConversationItems } from '@/lib/memory/conversation-store'
import {
  MAX_MEMORY_SUMMARY_CHARS,
  readMemorySummary,
  saveMemorySummary,
} from '@/lib/memory/summary-store'

const databaseUrl = process.env.MEMORY_PROVENANCE_TEST_DATABASE_URL
if (databaseUrl) {
  const location = new URL(databaseUrl)
  if (
    location.hostname !== '127.0.0.1' ||
    location.port !== '5433' ||
    location.pathname !== '/sim_durable_memory_e2e'
  )
    throw new Error('Summary integration tests require the isolated local test database')
}
const schemaName = `memory_summary_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 6,
      connection: { search_path: `${schemaName},public` },
      onnotice: () => {},
    })
  : undefined
const queries: string[] = []
const scope = { workspaceId: 'workspace-1', memoryId: 'memory-1', sourceHash: 'a'.repeat(64) }
const prefix = [{ role: 'user', content: 'Original conversation request' }]
const actor: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: scope.workspaceId,
  delegationId: 'delegation-1',
  audience: 'sim:memory',
  issuedAt: new Date(Date.now() - 1000),
  expiresAt: new Date(Date.now() + 60000),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment',
      deploymentVersionId: 'deployment-1',
    },
  },
}

async function cacheRow() {
  if (!connection) throw new Error('No test database')
  const [row] =
    await connection`SELECT encrypted_context_summary, data, storage_version FROM memory WHERE id = ${scope.memoryId}`
  return row
}

describe.skipIf(!databaseUrl)('derived summary cache in Postgres', () => {
  beforeAll(async () => {
    if (!connection) return
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    database.current = drizzle(connection, {
      logger: { logQuery: (query) => queries.push(query) },
    })
    await connection.unsafe(`
      CREATE TABLE workflow (id text PRIMARY KEY);
      CREATE TABLE execution_large_values (key text PRIMARY KEY);
      CREATE TABLE memory (
        id text PRIMARY KEY, workspace_id text NOT NULL, key text NOT NULL, data jsonb NOT NULL,
        secret_provenance_version integer, created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(), deleted_at timestamp,
        UNIQUE(workspace_id, key)
      );
      CREATE TABLE memory_secret_provenance (
        memory_id text PRIMARY KEY REFERENCES memory(id) ON DELETE CASCADE,
        content_hash text NOT NULL, status text NOT NULL, entries jsonb NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `)
    for (const name of ['0365_durable_agent_memory', '0366_agent_memory_context_summary']) {
      const migration = await readFile(
        new URL(`../../../../packages/db/migrations/${name}.sql`, import.meta.url),
        'utf8'
      )
      await connection.unsafe(migration.replaceAll('"public".', `"${schemaName}".`))
    }
  })
  beforeEach(async () => {
    if (!connection) return
    await connection`DELETE FROM memory`
    await connection`INSERT INTO memory (id, workspace_id, key, data, secret_provenance_version, storage_version) VALUES (${scope.memoryId}, ${scope.workspaceId}, 'conversation-1', ${JSON.stringify(prefix)}::jsonb, 1, 2)`
    await connection`INSERT INTO memory_secret_provenance (memory_id, content_hash, status, entries) VALUES (${scope.memoryId}, ${hashDurableSecretProvenanceValue(prefix)}, 'exact', '[]')`
    queries.length = 0
  })
  afterAll(async () => {
    if (!connection) return
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      await connection.end()
    }
  })

  it('reuses only the exact source hash and stores the summary solely as encrypted derived data', async () => {
    const content = 'Confirmed receipt: summary-receipt-123'
    await saveMemorySummary({ ...scope, content, sourceMessageCount: 2 })
    expect(await readMemorySummary(scope)).toBe(content)
    expect(await readMemorySummary({ ...scope, sourceHash: 'b'.repeat(64) })).toBeUndefined()
    const row = await cacheRow()
    expect(row.encrypted_context_summary).not.toContain('summary-receipt-123')
    expect(JSON.parse((await decryptSecret(row.encrypted_context_summary)).decrypted)).toEqual({
      version: 1,
      memoryId: scope.memoryId,
      sourceHash: scope.sourceHash,
      sourceMessageCount: 2,
      content,
    })
    expect(row.data).toEqual(prefix)
    expect((await readConversationItems(scope)).items).toEqual([])
  })

  it('cannot read or overwrite a cache through another workspace or memory owner', async () => {
    await saveMemorySummary({ ...scope, content: 'Original cache', sourceMessageCount: 2 })
    const original = (await cacheRow()).encrypted_context_summary
    for (const foreign of [
      { ...scope, workspaceId: 'foreign-workspace' },
      { ...scope, memoryId: 'foreign-memory' },
    ]) {
      expect(await readMemorySummary(foreign)).toBeUndefined()
      await saveMemorySummary({ ...foreign, content: 'Wrong owner', sourceMessageCount: 2 })
    }
    expect((await cacheRow()).encrypted_context_summary).toBe(original)
    const foreignCiphertext = await encryptSecret(
      JSON.stringify({
        version: 1,
        memoryId: 'foreign-memory',
        sourceHash: scope.sourceHash,
        content: 'Copied foreign cache',
        sourceMessageCount: 2,
      })
    )
    await connection!`UPDATE memory SET encrypted_context_summary = ${foreignCiphertext.encrypted} WHERE id = ${scope.memoryId}`
    expect(await readMemorySummary(scope)).toBeUndefined()
  })

  it('prevents stale summary writers from attaching to a deleted and recreated conversation', async () => {
    await saveMemorySummary({ ...scope, content: 'Deleted cache', sourceMessageCount: 2 })
    await deleteMemoryUseCase.execute({
      principal: actor,
      input: { workspaceId: scope.workspaceId, key: 'conversation-1' },
    })
    await connection!`INSERT INTO memory (id, workspace_id, key, data) VALUES ('replacement-memory', ${scope.workspaceId}, 'conversation-1', '[]')`
    await saveMemorySummary({ ...scope, content: 'Stale write', sourceMessageCount: 2 })
    expect(await readMemorySummary(scope)).toBeUndefined()
    expect(await readMemorySummary({ ...scope, memoryId: 'replacement-memory' })).toBeUndefined()
    expect(
      (
        await connection!`SELECT encrypted_context_summary FROM memory WHERE id = 'replacement-memory'`
      )[0].encrypted_context_summary
    ).toBeNull()
  })

  it('ignores a soft-deleted owner and cannot update its cache', async () => {
    await saveMemorySummary({ ...scope, content: 'Existing cache', sourceMessageCount: 2 })
    const original = (await cacheRow()).encrypted_context_summary
    await connection!`UPDATE memory SET deleted_at = now() WHERE id = ${scope.memoryId}`
    expect(await readMemorySummary(scope)).toBeUndefined()
    await saveMemorySummary({ ...scope, content: 'Stale change', sourceMessageCount: 2 })
    expect((await cacheRow()).encrypted_context_summary).toBe(original)
  })

  it('keeps deletion final when it races a summary replacement', async () => {
    await saveMemorySummary({ ...scope, content: 'Existing cache', sourceMessageCount: 2 })
    await Promise.all([
      saveMemorySummary({ ...scope, content: 'Concurrent replacement', sourceMessageCount: 3 }),
      deleteMemoryUseCase.execute({
        principal: actor,
        input: { workspaceId: scope.workspaceId, key: 'conversation-1' },
      }),
    ])
    expect(await readMemorySummary(scope)).toBeUndefined()
    expect(await connection!`SELECT id FROM memory WHERE id = ${scope.memoryId}`).toHaveLength(0)
  })

  it('replaces a single cache under concurrent writers without mixing source hashes and content', async () => {
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      ...scope,
      sourceHash: String(index + 1).repeat(64),
      content: `Summary candidate ${index}`,
      sourceMessageCount: index + 1,
    }))
    await Promise.all(candidates.map(saveMemorySummary))
    const stored = JSON.parse(
      (await decryptSecret((await cacheRow()).encrypted_context_summary)).decrypted
    )
    expect(candidates).toContainEqual({
      ...scope,
      sourceHash: stored.sourceHash,
      content: stored.content,
      sourceMessageCount: stored.sourceMessageCount,
    })
    for (const candidate of candidates)
      expect(await readMemorySummary(candidate)).toBe(
        candidate.sourceHash === stored.sourceHash ? candidate.content : undefined
      )
    expect(await connection!`SELECT id FROM memory`).toHaveLength(1)
    expect(await connection!`SELECT id FROM memory_item`).toHaveLength(0)
    expect((await cacheRow()).data).toEqual(prefix)
  })

  it('rejects invalid or oversized writes and does not fetch oversized cached ciphertext', async () => {
    await saveMemorySummary({ ...scope, content: 'Valid cache', sourceMessageCount: 2 })
    const original = (await cacheRow()).encrypted_context_summary
    for (const change of [
      { content: 'x'.repeat(MAX_MEMORY_SUMMARY_CHARS + 1) },
      { content: '   ' },
      { sourceMessageCount: 0 },
      { sourceMessageCount: 1.5 },
      { sourceHash: 'invalid' },
    ])
      await expect(
        saveMemorySummary({ ...scope, content: 'Valid', sourceMessageCount: 2, ...change })
      ).rejects.toThrow()
    expect((await cacheRow()).encrypted_context_summary).toBe(original)
    await connection!`UPDATE memory SET encrypted_context_summary = repeat('invalid-ciphertext', 100000) WHERE id = ${scope.memoryId}`
    queries.length = 0
    expect(await readMemorySummary(scope)).toBeUndefined()
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('CASE WHEN octet_length(')
    expect(queries[0]).toContain('ELSE NULL END')
  })

  it('supports the maximum Unicode summary while keeping the encrypted value within its SQL read cap', async () => {
    const content = '界'.repeat(MAX_MEMORY_SUMMARY_CHARS)
    await saveMemorySummary({ ...scope, content, sourceMessageCount: 1 })
    expect(await readMemorySummary(scope)).toBe(content)
    expect(Buffer.byteLength((await cacheRow()).encrypted_context_summary)).toBeLessThanOrEqual(
      64 * 1024
    )
  })

  it('excludes private cache bytes from ordinary read, list, and append projections and SQL', async () => {
    await saveMemorySummary({ ...scope, content: 'Private derived summary', sourceMessageCount: 2 })
    const privateValue = (await cacheRow()).encrypted_context_summary
    queries.length = 0
    const results = await Promise.all([
      readMemoryUseCase.execute({
        principal: actor,
        input: { workspaceId: scope.workspaceId, key: 'conversation-1' },
      }),
      listMemoriesUseCase.execute({
        principal: actor,
        input: { workspaceId: scope.workspaceId, limit: 10 },
      }),
      appendMemoryUseCase.execute({
        principal: actor,
        input: {
          workspaceId: scope.workspaceId,
          key: 'conversation-1',
          data: { role: 'assistant', content: 'New real message' },
        },
      }),
    ])
    expect(JSON.stringify(results)).not.toContain('encryptedContextSummary')
    expect(JSON.stringify(results)).not.toContain(privateValue)
    expect(JSON.stringify(results)).not.toContain('Private derived summary')
    expect(queries.join('\n')).not.toContain('encrypted_context_summary')
    await connection!`UPDATE memory SET encrypted_context_summary = repeat('oversized-private-value', 100000) WHERE id = ${scope.memoryId}`
    queries.length = 0
    expect(
      (
        await listMemoriesUseCase.execute({
          principal: actor,
          input: { workspaceId: scope.workspaceId, limit: 10 },
        })
      ).records
    ).toHaveLength(1)
    expect(queries.join('\n')).not.toContain('encrypted_context_summary')
  })
})
