import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { mothershipBenchmarks, permissions } from '@sim/db/schema'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = await vi.hoisted(async () => {
  const originalEnv = {
    MOTHERSHIP_BENCHMARK_ENABLED: process.env.MOTHERSHIP_BENCHMARK_ENABLED,
    MOTHERSHIP_BENCHMARK_URL: process.env.MOTHERSHIP_BENCHMARK_URL,
    COPILOT_API_KEY: process.env.COPILOT_API_KEY,
  }
  process.env.MOTHERSHIP_BENCHMARK_ENABLED = 'true'
  const { createServer } = await import('node:http')
  const requests: Record<string, unknown>[] = []
  const worker = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (request.url !== '/api/mothership/execute') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      return
    }
    const payload = JSON.parse(body) as Record<string, unknown>
    requests.push(payload)
    const frames = [
      { type: 'text', payload: { channel: 'assistant', text: '{"ok":true}' } },
      { type: 'complete', payload: { status: 'complete' } },
    ]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(
      frames
        .map(
          (frame, index) =>
            `data: ${JSON.stringify({
              v: 1,
              seq: index + 1,
              ts: new Date().toISOString(),
              stream: { streamId: payload.messageId },
              ...frame,
            })}\n\n`
        )
        .join('')
    )
  })
  await new Promise<void>((resolve) => worker.listen(0, '127.0.0.1', resolve))
  const address = worker.address()
  if (!address || typeof address === 'string') throw new Error('Worker fixture did not bind')
  process.env.MOTHERSHIP_BENCHMARK_URL = `http://127.0.0.1:${address.port}`
  process.env.COPILOT_API_KEY = 'local-benchmark-fixture'
  return { current: undefined as PostgresJsDatabase | undefined, worker, requests, originalEnv }
})
vi.mock('server-only', () => ({}))
vi.mock('@sim/db', () => {
  const scopedDatabase = new Proxy(
    {},
    {
      get(_target, property) {
        if (!database.current) throw new Error('Benchmark test database is not initialized')
        const value = Reflect.get(database.current, property)
        return typeof value === 'function' ? value.bind(database.current) : value
      },
    }
  )
  return { db: scopedDatabase, dbFor: () => scopedDatabase }
})

import { z } from 'zod'
import { createBenchmark, getBenchmark, listBenchmarks } from '@/lib/benchmarks/application/cases'
import { prepareBenchmarkExecution } from '@/lib/benchmarks/application/prepare-execution'
import { prepareBenchmarkPlan } from '@/lib/benchmarks/application/prepare-plan'
import {
  getBenchmarkRun,
  listBenchmarkRuns,
  reviewBenchmarkRun,
} from '@/lib/benchmarks/application/runs'
import {
  benchmarkAvailability,
  listBenchmarkOrganizations,
  listBenchmarkUsers,
  listBenchmarkWorkspaces,
} from '@/lib/benchmarks/application/selection'
import {
  claimBenchmarkStage,
  completeBenchmarkStage,
  createBenchmarkRecord,
  failBenchmarkStage,
  getBenchmarkRecord,
  getBenchmarkRunRecord,
  listBenchmarkRecords,
  listBenchmarkRunRecords,
  renewBenchmarkStage,
  updateBenchmarkRecord,
} from '@/lib/benchmarks/repository'
import { type BenchmarkArtifacts, emptyBenchmarkArtifacts } from '@/lib/benchmarks/types'
import { executeBenchmarkJson } from '@/lib/benchmarks/worker'
import { listOrganizationChats } from '@/lib/mothership/chat/organization-chats'

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
  const graded: BenchmarkArtifacts = {
    ...artifacts,
    referenceSpec: 'Queue: escalations. Owner: support.',
    redactedSpec: 'Queue: [[BLANK:queue]]. Owner: [[BLANK:owner]].',
    blanks: [
      { id: 'queue', answer: 'escalations' },
      { id: 'owner', answer: 'support' },
    ],
    generatedSpec: 'Queue: escalations.',
    reconstruction: [
      { id: 'queue', answer: 'escalations', support: 'Queue: escalations.' },
      { id: 'owner', answer: '', support: '' },
    ],
    grade: [
      { id: 'queue', correct: true, reason: 'Supported' },
      { id: 'owner', correct: false, reason: 'Missing' },
    ],
  }

  async function saveGrade(snapshot = graded, label = 'Baseline') {
    const current = await getBenchmarkRecord(scope)
    const attemptId = generateId()
    const claimed = await claimBenchmarkStage({
      ...scope,
      expectedVersion: current.version,
      stage: 'grade',
      attemptId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    const attempt = { ...scope, version: claimed.version, stage: 'grade' as const, attemptId }
    const completed = await completeBenchmarkStage({
      ...attempt,
      artifacts: snapshot,
      runLabel: label,
    })
    return { attempt, completed, runId: attemptId }
  }

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    for (const table of [
      'user',
      'settings',
      'copilot_chats',
      'copilot_runs',
      'copilot_request_stops',
      'copilot_organization_request_stops',
      'mothership_memory_selections',
      'mothership_memory_spaces',
      'organization',
      'member',
      'workspace',
      'permissions',
      'permission_group',
      'permission_group_member',
      'permission_group_workspace',
      'subscription',
      'mothership_benchmarks',
      'mothership_benchmark_runs',
    ]) {
      await connection`CREATE TABLE ${connection(table)} (LIKE ${connection(`public.${table}`)} INCLUDING ALL)`
    }
    await connection`ALTER TABLE copilot_runs ADD CONSTRAINT benchmark_chat_fk FOREIGN KEY (chat_id) REFERENCES copilot_chats(id)`
    database.current = drizzle(connection)
    await connection`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Owner', 'owner@benchmark.test', true, now(), now()), ('peer', 'Peer', 'peer@benchmark.test', true, now(), now())`
    await connection`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('target', 'Target', 'target@benchmark.test', true, now(), now())`
    await connection`INSERT INTO settings (id, user_id, super_user_mode_enabled) VALUES ('owner', 'owner', true), ('peer', 'peer', true)`
    await connection`INSERT INTO organization (id, name, slug) VALUES ('org', 'Org', 'org'), ('foreign-org', 'Foreign', 'foreign')`
    await connection`INSERT INTO member (id, organization_id, user_id, role) VALUES ('owner-member', 'org', 'owner', 'member'), ('peer-member', 'org', 'peer', 'member'), ('target-member', 'org', 'target', 'member')`
    await connection`INSERT INTO workspace (id, name, owner_id, billed_account_user_id, organization_id, workspace_mode) VALUES ('workspace', 'Source', 'owner', 'owner', 'org', 'organization'), ('foreign-workspace', 'Foreign', 'owner', 'owner', 'foreign-org', 'organization')`
  })

  beforeEach(async () => {
    await connection`TRUNCATE mothership_benchmark_runs, mothership_benchmarks, permissions, copilot_runs, copilot_chats`
    await connection`UPDATE "user" SET role = CASE WHEN id IN ('owner', 'peer') THEN 'admin' ELSE 'user' END, banned = false`
    await connection`UPDATE settings SET super_user_mode_enabled = true`
    await connection`UPDATE member SET role = 'member' WHERE id = 'owner-member'`
    await connection`INSERT INTO member (id, organization_id, user_id, role) VALUES ('owner-member', 'org', 'owner', 'member'), ('target-member', 'org', 'target', 'member') ON CONFLICT (id) DO UPDATE SET organization_id = 'org'`
    await connection`INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type) VALUES ('owner-read', 'owner', 'workspace', 'workspace', 'read'), ('peer-read', 'peer', 'workspace', 'workspace', 'read'), ('target-read', 'target', 'workspace', 'workspace', 'read')`
    await createBenchmarkRecord({
      ...scope,
      sourceWorkspaceId: 'workspace',
      name: 'Test benchmark',
      artifacts,
    })
  })

  afterAll(async () => {
    for (const [key, value] of Object.entries(database.originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      database.current = undefined
      await connection.end()
      await new Promise<void>((resolve, reject) => {
        database.worker.close((error) => (error ? reject(error) : resolve()))
        database.worker.closeAllConnections()
      })
    }
  })

  it('completes isolated JSON executions through the real lifecycle with fresh target-owned chats', async () => {
    const { benchmark } = await createBenchmark.execute({
      principal,
      input: {
        organizationId: 'org',
        sourceWorkspaceId: 'workspace',
        runAsUserId: 'target',
        name: 'JSON execution',
      },
    })
    database.requests.length = 0
    for (let attempt = 0; attempt < 2; attempt++) {
      const input = {
        principal,
        benchmark,
        messages: [{ role: 'user' as const, content: 'Return the fixture result.' }],
        schema: z.object({ ok: z.literal(true) }),
        signal: new AbortController().signal,
      }
      expect(await executeBenchmarkJson(input)).toMatchObject({ data: { ok: true } })
    }
    const runs =
      await connection`SELECT r.status, r.user_id, c.user_id AS chat_user_id, c.config FROM copilot_runs r JOIN copilot_chats c ON c.id = r.chat_id`
    expect(runs).toHaveLength(2)
    for (const run of runs)
      expect(run).toMatchObject({
        status: 'complete',
        user_id: 'target',
        chat_user_id: 'target',
        config: { benchmark: { id: benchmark.id, operatorUserId: 'owner' } },
      })
    expect(database.requests).toHaveLength(2)
    expect(new Set(database.requests.map((request) => request.chatId)).size).toBe(2)
    for (const request of database.requests)
      expect(request).toMatchObject({
        userId: 'target',
        useConversationHistory: false,
        messages: [{ role: 'user', content: 'Return the fixture result.' }],
      })
  })

  it('runs reference recovery in a fresh target-owned organization conversation without the source workspace', async () => {
    await connection`UPDATE "user" SET role = 'admin' WHERE id = 'target'`
    await connection`INSERT INTO settings (id, user_id, super_user_mode_enabled) VALUES ('target', 'target', true) ON CONFLICT (user_id) DO UPDATE SET super_user_mode_enabled = true`
    await connection`UPDATE member SET role = 'owner' WHERE id = 'owner-member'`
    const { benchmark } = await createBenchmark.execute({
      principal,
      input: {
        organizationId: 'org',
        sourceWorkspaceId: 'workspace',
        runAsUserId: 'target',
        name: 'Reference recovery',
      },
    })
    database.requests.length = 0
    expect(
      await executeBenchmarkJson({
        principal,
        benchmark,
        signal: new AbortController().signal,
        messages: [{ role: 'user', content: 'Repository: [[BLANK:repo]].' }],
        profile: { stage: 'resolve', spec: 'Use the Sim repository.' },
        schema: z.object({ ok: z.literal(true) }),
      })
    ).toMatchObject({ data: { ok: true } })
    const [request] = database.requests
    expect(request).toMatchObject({
      userId: 'target',
      organizationId: 'org',
      mode: 'plan',
      benchmark: { stage: 'resolve', spec: 'Use the Sim repository.' },
      useConversationHistory: false,
    })
    expect(request).not.toHaveProperty('workspaceId')
    if (typeof request?.chatId !== 'string') throw new Error('Missing recovery conversation')
    const [chat] =
      await connection`SELECT user_id, organization_id, workspace_id FROM copilot_chats WHERE id = ${request.chatId}`
    expect(chat).toEqual({ user_id: 'target', organization_id: 'org', workspace_id: null })
  })

  it('requires a current superuser role and enabled toggle even when the deployment flag is on', async () => {
    for (const change of [
      async () => {
        await connection`UPDATE "user" SET role = 'user' WHERE id = 'owner'`
      },
      async () => {
        await connection`UPDATE "user" SET role = 'admin' WHERE id = 'owner'`
        await connection`UPDATE settings SET super_user_mode_enabled = false WHERE user_id = 'owner'`
      },
    ]) {
      await change()
      expect(await benchmarkAvailability.execute({ principal, input: {} })).toEqual({
        available: false,
      })
      await expect(
        listBenchmarkOrganizations.execute({ principal, input: { search: '' } })
      ).rejects.toMatchObject({ code: 'not_found' })
      await expect(
        getBenchmark.execute({
          principal,
          input: { organizationId: 'org', benchmarkId: 'benchmark' },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await expect(
        createBenchmark.execute({
          principal,
          input: {
            organizationId: 'org',
            sourceWorkspaceId: 'workspace',
            runAsUserId: 'target',
            name: 'Denied',
          },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(
      (await connection`SELECT count(*)::int AS count FROM mothership_benchmarks`)[0]?.count
    ).toBe(1)
  })

  it('lets a superuser outside the organization prepare a private Plan owned by an eligible target', async () => {
    await connection`DELETE FROM member WHERE user_id = 'owner'`
    expect(
      (
        await listBenchmarkOrganizations.execute({ principal, input: { search: 'Org' } })
      ).organizations.map((org) => org.id)
    ).toContain('org')
    expect(
      (
        await listBenchmarkUsers.execute({
          principal,
          input: { organizationId: 'org', search: 'target' },
        })
      ).users.map((user) => user.id)
    ).toEqual(['target'])
    expect(
      (
        await listBenchmarkWorkspaces.execute({
          principal,
          input: { organizationId: 'org', runAsUserId: 'target', search: '' },
        })
      ).workspaces
    ).toEqual([{ id: 'workspace', name: 'Source' }])
    const { benchmark } = await createBenchmark.execute({
      principal,
      input: {
        organizationId: 'org',
        sourceWorkspaceId: 'workspace',
        runAsUserId: 'target',
        name: 'Target case',
      },
    })
    expect(benchmark).toMatchObject({ userId: 'owner', runAsUserId: 'target' })
    const reference = await prepareBenchmarkExecution.execute({
      principal,
      input: { organizationId: 'org', benchmarkId: benchmark.id },
    })
    const [referenceChat] =
      await connection`SELECT user_id, workspace_id, organization_id, config FROM copilot_chats WHERE id = ${reference.chatId}`
    expect(referenceChat).toMatchObject({
      user_id: 'target',
      workspace_id: 'workspace',
      organization_id: null,
      config: {
        conversationMode: 'agent',
        benchmark: { id: benchmark.id, operatorUserId: 'owner' },
      },
    })
    await expect(
      prepareBenchmarkPlan.execute({
        principal,
        input: { organizationId: 'org', benchmarkId: benchmark.id },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Plan mode is unavailable' })
    await connection`UPDATE "user" SET role = 'admin' WHERE id = 'target'`
    await connection`INSERT INTO settings (id, user_id, super_user_mode_enabled) VALUES ('target', 'target', true) ON CONFLICT (user_id) DO UPDATE SET super_user_mode_enabled = true`
    const target = await prepareBenchmarkPlan.execute({
      principal,
      input: { organizationId: 'org', benchmarkId: benchmark.id },
    })
    expect(target.userId).toBe('target')
    const [chat] =
      await connection`SELECT user_id, organization_id, config FROM copilot_chats WHERE id = ${target.chatId}`
    expect(chat).toMatchObject({
      user_id: 'target',
      organization_id: 'org',
      config: {
        conversationMode: 'plan',
        benchmark: { id: benchmark.id, operatorUserId: 'owner' },
      },
    })
    await connection`INSERT INTO copilot_chats (id, user_id, organization_id, type, config) VALUES ('00000000-0000-4000-8000-000000000001', 'target', 'org', 'mothership', '{"conversationMode":"assistant"}')`
    const chats = await listOrganizationChats.execute({
      principal: { ...principal, userId: 'target' },
      input: { organizationId: 'org', scope: 'active' },
    })
    expect(chats.map((chat) => chat.id)).toEqual(['00000000-0000-4000-8000-000000000001'])
    expect(principal).toEqual({ kind: 'session', userId: 'owner', sessionId: 'fixture-session' })
    expect(await connection`SELECT id FROM member WHERE user_id = 'owner'`).toHaveLength(0)
    expect(
      (
        await listBenchmarks.execute({
          principal,
          input: { organizationId: 'org', runAsUserId: 'target', limit: 20 },
        })
      ).benchmarks.map((row) => row.id)
    ).toEqual([benchmark.id])
    await connection`DELETE FROM permissions WHERE id = 'target-read'`
    await expect(
      prepareBenchmarkPlan.execute({
        principal,
        input: { organizationId: 'org', benchmarkId: benchmark.id },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      prepareBenchmarkExecution.execute({
        principal,
        input: { organizationId: 'org', benchmarkId: benchmark.id },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await connection`SELECT id FROM copilot_chats`).toHaveLength(3)
  })

  it('refuses a target outside the organization or with revoked membership, disabled account, or workspace access', async () => {
    const input = {
      organizationId: 'org',
      sourceWorkspaceId: 'workspace',
      runAsUserId: 'target',
      name: 'Target case',
    }
    await connection`UPDATE member SET organization_id = 'foreign-org' WHERE user_id = 'target'`
    await expect(createBenchmark.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    await connection`UPDATE member SET organization_id = 'org' WHERE user_id = 'target'`
    await connection`UPDATE "user" SET banned = true WHERE id = 'target'`
    await expect(createBenchmark.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    await connection`UPDATE "user" SET banned = false WHERE id = 'target'`
    await connection`DELETE FROM permissions WHERE id = 'target-read'`
    await expect(createBenchmark.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(
      (await connection`SELECT count(*)::int AS count FROM mothership_benchmarks`)[0]?.count
    ).toBe(1)
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
    expect(
      await renewBenchmarkStage({
        ...scope,
        version: old.version,
        stage: 'plan',
        attemptId: 'old',
        leaseExpiresAt: new Date(Date.now() + 120_000),
      })
    ).toBe(false)
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

  it('extends only the current live lease without invalidating the attempt version', async () => {
    const claimed = await claimBenchmarkStage({
      ...scope,
      expectedVersion: 1,
      stage: 'distill',
      attemptId: 'long-inspection',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    const attempt = {
      ...scope,
      version: claimed.version,
      stage: 'distill' as const,
      attemptId: 'long-inspection',
    }
    const leaseExpiresAt = new Date(Date.now() + 120_000)
    expect(await renewBenchmarkStage({ ...attempt, leaseExpiresAt })).toBe(true)
    const current = await getBenchmarkRecord(scope)
    expect(current.version).toBe(claimed.version)
    expect(current.leaseExpiresAt).toBe(leaseExpiresAt.toISOString())
    await completeBenchmarkStage({ ...attempt, artifacts })
    expect(await renewBenchmarkStage({ ...attempt, leaseExpiresAt })).toBe(false)
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
          runAsUserId: 'owner',
          name: 'Wrong source',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(
      (await connection`SELECT count(*)::int AS count FROM mothership_benchmarks`)[0]?.count
    ).toBe(1)
  })

  it('rejects automatic scores outside the saved run total at the database boundary', async () => {
    const saved = await saveGrade()
    for (const score of [-1, graded.blanks.length + 1]) {
      await expect(
        connection`UPDATE mothership_benchmark_runs SET automatic_correct = ${score} WHERE id = ${saved.runId}`
      ).rejects.toMatchObject({
        code: '23514',
        constraint_name: 'mothership_benchmark_runs_automatic_score_check',
      })
    }
    expect((await getBenchmarkRunRecord({ ...scope, runId: saved.runId })).automaticCorrect).toBe(1)
  })

  it('paginates distinct and tied PostgreSQL microsecond timestamps without omissions', async () => {
    const first = await saveGrade()
    const second = await saveGrade()
    const third = await saveGrade()
    await connection`UPDATE mothership_benchmark_runs SET created_at = '2026-01-01 00:00:00.123456' WHERE id = ${first.runId}`
    await connection`UPDATE mothership_benchmark_runs SET created_at = '2026-01-01 00:00:00.123789' WHERE id IN (${second.runId}, ${third.runId})`
    const runIds: string[] = []
    let cursor: string | null = null
    for (let index = 0; index < 3; index++) {
      const page = await listBenchmarkRunRecords({
        ...scope,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      })
      runIds.push(...page.runs.map((row) => row.id))
      cursor = page.nextCursor
      if (index < 2) expect(cursor).not.toBeNull()
    }
    expect(cursor).toBeNull()
    expect(runIds).toEqual([...[second.runId, third.runId].sort().reverse(), first.runId])
    for (const benchmarkId of ['case-newer-a', 'case-newer-b']) {
      await createBenchmarkRecord({
        ...scope,
        benchmarkId,
        sourceWorkspaceId: 'workspace',
        name: 'Additional case',
        artifacts,
      })
    }
    await connection`UPDATE mothership_benchmarks SET created_at = '2026-01-01 00:00:00.123456' WHERE id = ${scope.benchmarkId}`
    await connection`UPDATE mothership_benchmarks SET created_at = '2026-01-01 00:00:00.123789' WHERE id IN ('case-newer-a', 'case-newer-b')`
    const caseIds: string[] = []
    for (let index = 0; index < 3; index++) {
      const page = await listBenchmarkRecords({ ...scope, limit: 1, ...(cursor ? { cursor } : {}) })
      caseIds.push(...page.benchmarks.map((row) => row.id))
      cursor = page.nextCursor
      if (index < 2) expect(cursor).not.toBeNull()
    }
    expect(cursor).toBeNull()
    expect(caseIds).toEqual(['case-newer-b', 'case-newer-a', scope.benchmarkId])
  })

  it('retains immutable graded artifacts across edits, with scores and bounded summary pagination', async () => {
    const first = await saveGrade()
    await updateBenchmarkRecord({
      ...scope,
      version: first.completed.version,
      name: 'Changed',
      artifacts,
    })
    const second = await saveGrade(
      { ...graded, generatedSpec: 'A different generated plan.' },
      'Improved discovery'
    )
    const firstRun = await getBenchmarkRunRecord({ ...scope, runId: first.runId })
    expect(firstRun.execution).toEqual({
      organizationId: 'org',
      sourceWorkspaceId: 'workspace',
      operatorUserId: 'owner',
      runAsUserId: 'owner',
    })
    expect(firstRun).toMatchObject({ label: 'Baseline', correct: 1, total: 2, artifacts: graded })
    const secondRun = await getBenchmarkRunRecord({ ...scope, runId: second.runId })
    expect(secondRun.evaluationKey).toBe(firstRun.evaluationKey)
    const page = await listBenchmarkRunRecords({ ...scope, limit: 1 })
    expect(page.runs.map((run) => run.id)).toEqual([second.runId])
    expect(page.runs[0]).not.toHaveProperty('artifacts')
    expect(page.nextCursor).toBeTypeOf('string')
    if (!page.nextCursor) throw new Error('Expected a continuation cursor')
    const next = await listBenchmarkRunRecords({ ...scope, limit: 1, cursor: page.nextCursor })
    expect(next.runs.map((run) => run.id)).toEqual([first.runId])
    expect(next.nextCursor).toBeNull()
    const changed = await saveGrade({ ...graded, taskBrief: 'A different task' })
    expect(
      (await getBenchmarkRunRecord({ ...scope, runId: changed.runId })).evaluationKey
    ).not.toBe(firstRun.evaluationKey)
    await expect(
      completeBenchmarkStage({ ...first.attempt, artifacts: graded })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await listBenchmarkRunRecords({ ...scope, limit: 50 })).runs).toHaveLength(3)
  })

  it('rolls back grade completion if its immutable snapshot cannot be saved', async () => {
    const saved = await saveGrade()
    const claimed = await claimBenchmarkStage({
      ...scope,
      expectedVersion: saved.completed.version,
      stage: 'grade',
      attemptId: saved.runId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    await expect(
      completeBenchmarkStage({
        ...scope,
        version: claimed.version,
        stage: 'grade',
        attemptId: saved.runId,
        artifacts: { ...graded, generatedSpec: 'Must not be committed' },
      })
    ).rejects.toThrow()
    expect(await getBenchmarkRecord(scope)).toMatchObject({
      version: claimed.version,
      runningStage: 'grade',
      artifacts: graded,
    })
    expect((await listBenchmarkRunRecords({ ...scope, limit: 50 })).runs).toHaveLength(1)
  })

  it('authorizes saved runs through their private parent and current source access', async () => {
    const saved = await saveGrade()
    const input = { organizationId: 'org', benchmarkId: 'benchmark', runId: saved.runId }
    expect((await getBenchmarkRun.execute({ principal, input })).run.artifacts).toEqual(graded)
    await expect(
      getBenchmarkRun.execute({ principal: { ...principal, userId: 'peer' }, input })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      getBenchmarkRun.execute({ principal, input: { ...input, organizationId: 'foreign-org' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await createBenchmarkRecord({
      ...scope,
      benchmarkId: 'another',
      sourceWorkspaceId: 'workspace',
      name: 'Other case',
      artifacts,
    })
    await expect(
      getBenchmarkRun.execute({ principal, input: { ...input, benchmarkId: 'another' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await db.delete(permissions).where(eq(permissions.id, 'owner-read'))
    await expect(getBenchmarkRun.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(
      listBenchmarkRuns.execute({ principal, input: { ...input, limit: 20 } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      reviewBenchmarkRun.execute({
        principal,
        input: { ...input, version: 1, blankId: 'owner', correct: true, note: 'Reviewed' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('keeps AI judgments intact while human corrections update scores and can be undone', async () => {
    const saved = await saveGrade()
    const input = {
      organizationId: 'org',
      benchmarkId: 'benchmark',
      runId: saved.runId,
      blankId: 'owner',
      correct: true,
      note: 'The support team is clearly implied by the surrounding plan.',
    }
    await expect(
      reviewBenchmarkRun.execute({
        principal: { ...principal, userId: 'peer' },
        input: { ...input, version: 1 },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    const reviewed = (
      await reviewBenchmarkRun.execute({ principal, input: { ...input, version: 1 } })
    ).run
    expect(reviewed).toMatchObject({
      correct: 2,
      automaticCorrect: 1,
      reviewedCount: 1,
      version: 2,
      artifacts: graded,
      reviews: [{ id: 'owner', correct: true, note: input.note }],
    })
    expect((await listBenchmarkRunRecords({ ...scope, limit: 20 })).runs[0]).toMatchObject({
      correct: 2,
      automaticCorrect: 1,
      reviewedCount: 1,
    })
    const races = await Promise.allSettled([
      reviewBenchmarkRun.execute({
        principal,
        input: { ...input, version: 2, blankId: 'queue', correct: false },
      }),
      reviewBenchmarkRun.execute({ principal, input: { ...input, version: 2, correct: false } }),
    ])
    expect(races.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(races.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'conflict' } },
    ])
    let current = await getBenchmarkRunRecord({ ...scope, runId: saved.runId })
    expect(current.correct).toBe(1)
    expect(current.artifacts.grade).toEqual(graded.grade)
    for (const review of current.reviews) {
      current = (
        await reviewBenchmarkRun.execute({
          principal,
          input: { ...input, version: current.version, blankId: review.id, correct: null },
        })
      ).run
    }
    expect(current).toMatchObject({
      correct: 1,
      automaticCorrect: 1,
      reviewedCount: 0,
      reviews: [],
      artifacts: graded,
    })
    await expect(
      reviewBenchmarkRun.execute({
        principal,
        input: { ...input, version: current.version, blankId: 'unknown' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
})
