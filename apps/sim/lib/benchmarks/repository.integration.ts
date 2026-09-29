import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { mothershipBenchmarks, permissions } from '@sim/db/schema'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  process.env.MOTHERSHIP_BENCHMARK_ENABLED = 'true'
  return { current: undefined as PostgresJsDatabase | undefined }
})
vi.mock('server-only', () => ({}))
vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Benchmark test database is not initialized')
    return database.current
  },
}))

import { createBenchmark, getBenchmark, listBenchmarks } from '@/lib/benchmarks/application/cases'
import {
  claimBenchmarkStage,
  completeBenchmarkStage,
  createBenchmarkRecord,
  failBenchmarkStage,
  getBenchmarkRecord,
  updateBenchmarkRecord,
} from '@/lib/benchmarks/repository'
import { emptyBenchmarkArtifacts } from '@/lib/benchmarks/types'

describe('private benchmark persistence and attempt fencing', () => {
  const schemaName = `benchmark_test_${generateId().replaceAll('-', '')}`
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('Benchmark tests require a disposable local test database')
  const connection = postgres(
    databaseUrl,
    withUtcTimestamps({
      max: 4,
      prepare: false,
      fetch_types: false,
      connection: { search_path: `${schemaName},public` },
      onnotice: () => {},
    })
  )
  const scope = { organizationId: 'org', userId: 'owner', benchmarkId: 'benchmark' }
  const principal: SessionPrincipal = {
    kind: 'session',
    userId: 'owner',
    sessionId: 'fixture-session',
  }
  const artifacts = emptyBenchmarkArtifacts('Plan an escalation workflow.')

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    for (const table of [
      'user',
      'organization',
      'member',
      'workspace',
      'permissions',
      'permission_group',
      'permission_group_member',
      'permission_group_workspace',
      'subscription',
      'mothership_benchmarks',
    ]) {
      await connection`CREATE TABLE ${connection(table)} (LIKE ${connection(`public.${table}`)} INCLUDING ALL)`
    }
    database.current = drizzle(connection)
    await connection`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Owner', 'owner@benchmark.test', true, now(), now()), ('peer', 'Peer', 'peer@benchmark.test', true, now(), now())`
    await connection`INSERT INTO organization (id, name, slug) VALUES ('org', 'Org', 'org'), ('foreign-org', 'Foreign', 'foreign')`
    await connection`INSERT INTO member (id, organization_id, user_id, role) VALUES ('owner-member', 'org', 'owner', 'member'), ('peer-member', 'org', 'peer', 'member')`
    await connection`INSERT INTO workspace (id, name, owner_id, billed_account_user_id, organization_id, workspace_mode) VALUES ('workspace', 'Source', 'owner', 'owner', 'org', 'organization'), ('foreign-workspace', 'Foreign', 'owner', 'owner', 'foreign-org', 'organization')`
  })

  beforeEach(async () => {
    await connection`TRUNCATE mothership_benchmarks, permissions`
    await connection`INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type) VALUES ('owner-read', 'owner', 'workspace', 'workspace', 'read'), ('peer-read', 'peer', 'workspace', 'workspace', 'read')`
    await createBenchmarkRecord({
      ...scope,
      sourceWorkspaceId: 'workspace',
      name: 'Test benchmark',
      artifacts,
    })
  })

  afterAll(async () => {
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      database.current = undefined
      await connection.end()
    }
  })

  it('admits one competing stage and refuses edits while that attempt holds its lease', async () => {
    const contenders = await Promise.allSettled(
      ['a', 'b'].map((attemptId) =>
        claimBenchmarkStage({
          ...scope,
          expectedVersion: 1,
          stage: 'plan',
          attemptId,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        })
      )
    )
    expect(contenders.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(contenders.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const claimed = await getBenchmarkRecord(scope)
    await expect(
      updateBenchmarkRecord({ ...scope, version: claimed.version, name: 'Changed', artifacts })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('lets an expired attempt be retried and prevents its late success or error from replacing the retry', async () => {
    const old = await claimBenchmarkStage({
      ...scope,
      expectedVersion: 1,
      stage: 'plan',
      attemptId: 'old',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    await db
      .update(mothershipBenchmarks)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(mothershipBenchmarks.id, scope.benchmarkId))
    const next = await claimBenchmarkStage({
      ...scope,
      expectedVersion: old.version,
      stage: 'plan',
      attemptId: 'next',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    await expect(
      completeBenchmarkStage({
        ...scope,
        version: old.version,
        stage: 'plan',
        attemptId: 'old',
        artifacts: { ...artifacts, generatedSpec: 'Stale plan' },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(
      await failBenchmarkStage({
        ...scope,
        version: old.version,
        stage: 'plan',
        attemptId: 'old',
        error: 'Late failure',
      })
    ).toBeNull()
    const completed = await completeBenchmarkStage({
      ...scope,
      version: next.version,
      stage: 'plan',
      attemptId: 'next',
      artifacts: { ...artifacts, generatedSpec: 'Current plan' },
    })
    expect(completed.artifacts.generatedSpec).toBe('Current plan')
    expect(completed.runningStage).toBeNull()
  })

  it('keeps artifacts private even from another member who can read the same workspace', async () => {
    await expect(
      getBenchmark.execute({
        principal: { ...principal, userId: 'peer' },
        input: { organizationId: 'org', benchmarkId: 'benchmark' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      getBenchmark.execute({
        principal,
        input: { organizationId: 'foreign-org', benchmarkId: 'benchmark' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(
      (
        await getBenchmark.execute({
          principal,
          input: { organizationId: 'org', benchmarkId: 'benchmark' },
        })
      ).benchmark.name
    ).toBe('Test benchmark')
  })

  it('rechecks source workspace access when reading and listing a saved benchmark', async () => {
    await db.delete(permissions).where(eq(permissions.id, 'owner-read'))
    await expect(
      getBenchmark.execute({
        principal,
        input: { organizationId: 'org', benchmarkId: 'benchmark' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(
      (await listBenchmarks.execute({ principal, input: { organizationId: 'org', limit: 20 } }))
        .benchmarks
    ).toEqual([])
  })

  it('refuses to create a case whose source belongs to another organization', async () => {
    await expect(
      createBenchmark.execute({
        principal,
        input: {
          organizationId: 'org',
          sourceWorkspaceId: 'foreign-workspace',
          name: 'Wrong source',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(
      (await connection`SELECT count(*)::int AS count FROM mothership_benchmarks`)[0]?.count
    ).toBe(1)
  })
})
