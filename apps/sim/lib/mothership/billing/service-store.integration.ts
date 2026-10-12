/** Local SQL verifies receipt durability, concurrent claims and replay independently of tool completion. */

import { readFileSync } from 'node:fs'
import { generateId } from '@sim/utils/id'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  schema: `service_meter_${process.pid}`,
  client: null as Sql | null,
}))
vi.mock('@sim/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  const { readTestDatabaseUrl } = await import('@sim/db/testing/test-infrastructure')
  const client = postgres(readTestDatabaseUrl(), {
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
  closeAbandonedServiceMeters,
  finishServiceUsage,
  saveServiceUsage,
} from './service-store'

afterAll(async () => {
  await state.client?.end()
  vi.unstubAllGlobals()
})
describe('service receipts in SQL', () => {
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
      streamId: generateId(),
      toolCallId: 'tool',
      workerOrigin: 'http://127.0.0.1:8080',
    }
    const intentId = generateId()
    await beginServiceMeter({ ...base, id: intentId })
    const receipt = {
      id: generateId(),
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
    await client`UPDATE copilot_service_usage SET next_attempt_at=now()`
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
    await finishServiceUsage(intentId)
    const [intent] =
      await client`SELECT delivered_at, last_error FROM copilot_service_usage WHERE id=${intentId}`
    expect(intent.delivered_at).not.toBeNull()
    expect(intent.last_error).toBeNull()
  })

  it('closes each abandoned tool meter once and leaves in-flight meters and receipts open', async () => {
    const client = state.client!
    const scope = {
      streamId: generateId(),
      toolCallId: 'abandoned-tool',
      workerOrigin: 'http://127.0.0.1:8080',
    }
    const abandoned = generateId()
    const failed = generateId()
    const inFlight = generateId()
    for (const id of [abandoned, failed, inFlight]) await beginServiceMeter({ ...scope, id })
    await finishServiceUsage(failed, 'provider pricing unavailable')
    const receipt = {
      id: generateId(),
      streamId: scope.streamId,
      toolCallId: scope.toolCallId,
      service: 'exa',
      costUsd: 0.25,
    }
    await saveServiceUsage(receipt, scope.workerOrigin)
    await client`UPDATE copilot_service_usage SET created_at = now() - interval '1 day' WHERE id IN ${client([abandoned, failed, receipt.id])}`
    // Past the longest tool watchdog, but a tool can still be cleaning up after it.
    await client`UPDATE copilot_service_usage SET created_at = now() - interval '61 minutes' WHERE id = ${inFlight}`

    const closed = (
      await Promise.all([closeAbandonedServiceMeters(), closeAbandonedServiceMeters()])
    ).flat()
    expect(closed).toHaveLength(2)
    expect(new Map(closed.map((meter) => [meter.id, meter.lastError]))).toEqual(
      new Map([
        [abandoned, expect.any(String)],
        [failed, 'provider pricing unavailable'],
      ])
    )
    expect(closed.every((meter) => meter.streamId === scope.streamId)).toBe(true)
    expect(await closeAbandonedServiceMeters()).toEqual([])
    // The watchdog only stops the chat waiting, so the owner can still finish after the close.
    await finishServiceUsage(abandoned)
    await finishServiceUsage(failed, 'late failure')
    const lateRows =
      await client`SELECT id, last_error FROM copilot_service_usage WHERE id IN ${client([abandoned, failed])}`
    expect(new Map(lateRows.map((row) => [row.id, row.last_error]))).toEqual(
      new Map(closed.map((meter) => [meter.id, meter.lastError]))
    )

    const open =
      await client`SELECT id FROM copilot_service_usage WHERE stream_id = ${scope.streamId} AND delivered_at IS NULL`
    expect(open.map((row) => row.id).sort()).toEqual([inFlight, receipt.id].sort())
    expect((await claimServiceUsage()).map((row) => row.id)).toEqual([receipt.id])
  })
})
