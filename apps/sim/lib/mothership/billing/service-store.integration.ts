/** Local SQL verifies receipt durability, concurrent claims and replay independently of tool completion. */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  url: process.env.TEST_DATABASE_URL,
  schema: `service_meter_${process.pid}`,
  client: null as Sql | null,
}))
vi.mock('@sim/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  if (state.url && !['localhost', '127.0.0.1'].includes(new URL(state.url).hostname))
    throw new Error('Local test database required')
  const client = postgres(state.url ?? 'postgres://127.0.0.1:1/unused', {
    max: 4,
    connection: { search_path: state.schema },
    onnotice: () => {},
  })
  state.client = client
  return { db: drizzle(client), dbReplica: drizzle(client) }
})
vi.mock('@/lib/mothership/request/headers', () => ({
  mothershipRequestHeaders: () => ({
    'Content-Type': 'application/json',
    'x-api-key': 'local-test-key',
  }),
}))

import { replayServiceUsage } from './service-delivery'
import {
  beginServiceMeter,
  claimServiceUsage,
  finishServiceUsage,
  saveServiceUsage,
  serviceMeteringHealth,
} from './service-store'

afterAll(async () => {
  await state.client?.end()
  vi.unstubAllGlobals()
})
describe.skipIf(!state.url)('service receipts in SQL', () => {
  beforeAll(async () => {
    const client = state.client!
    await client.unsafe(`CREATE SCHEMA "${state.schema}"`)
    const migration = readFileSync(
      new URL(
        '../../../../../packages/db/migrations/0380_mothership_staging_merge.sql',
        import.meta.url
      ),
      'utf8'
    )
    const table = migration.match(
      /CREATE TABLE IF NOT EXISTS "copilot_service_usage" \([\s\S]*?\n\);/
    )?.[0]
    const index = migration.match(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_service_usage_pending_idx"[^;]+;/
    )?.[0]
    if (!table || !index) throw new Error('Service usage migration was not found')
    await client.unsafe(table)
    await client.unsafe(index)
  })
  afterAll(async () => {
    await state.client?.unsafe(`DROP SCHEMA IF EXISTS "${state.schema}" CASCADE`)
  })
  it('claims each known receipt once while preserving incomplete measurement and delivery failures', async () => {
    const client = state.client!
    const base = {
      streamId: randomUUID(),
      toolCallId: 'tool',
      workerOrigin: 'http://127.0.0.1:8080',
    }
    const intentId = randomUUID()
    await beginServiceMeter({ ...base, id: intentId })
    const receipt = {
      id: randomUUID(),
      streamId: base.streamId,
      toolCallId: base.toolCallId,
      service: 'exa',
      costUsd: 0.5,
    }
    await saveServiceUsage(receipt, base.workerOrigin)
    await saveServiceUsage(receipt, base.workerOrigin)
    const claims = await Promise.all([claimServiceUsage(), claimServiceUsage()])
    expect(claims.flat().map((row) => row.id)).toEqual([receipt.id])
    await finishServiceUsage(receipt.id, 'connection interrupted')
    expect(await claimServiceUsage()).toEqual([])
    await client`UPDATE copilot_service_usage SET next_attempt_at=now(), created_at=now()-interval '10 minutes'`
    expect((await serviceMeteringHealth())?.unknown).toBe(1)
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      expect(body.receipts).toEqual([receipt])
      return Response.json({ accepted: [receipt.id] })
    })
    vi.stubGlobal('fetch', fetcher)
    await Promise.all([replayServiceUsage(), replayServiceUsage()])
    expect(fetcher).toHaveBeenCalledOnce()
    const [row] =
      await client`SELECT delivered_at, cost_usd, worker_origin FROM copilot_service_usage WHERE id=${receipt.id}`
    expect(row.delivered_at).not.toBeNull()
    expect(Number(row.cost_usd)).toBe(0.5)
    expect(row.worker_origin).toBe(base.workerOrigin)
    expect((await serviceMeteringHealth())?.pending).toBe(0)
    await finishServiceUsage(intentId)
    expect((await serviceMeteringHealth())?.unknown).toBe(0)
  })
})
