/**
 * The inline job claim under a dropped connection, against real PostgreSQL. A TCP proxy between
 * the app's `db` client and Postgres cuts the connection on the claim `UPDATE`, either when its
 * `UPDATE 1` answer comes back (the claim committed; the answer is lost) or before sending it. Ingress has
 * already acknowledged the delivery by then, so the job must still run, exactly once.
 */
import { asyncJobs } from '@sim/db'
import { sleep } from '@sim/utils/helpers'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { DatabaseJobQueue } from '@/lib/core/async-jobs/backends/database'
import type { Job } from '@/lib/core/async-jobs/types'

type ClaimFault = 'drop-answer' | 'drop-before-send'

const proxy = await vi.hoisted(async () => {
  const { createServer, connect } = await import('node:net')
  const directUrl = process.env.DATABASE_URL ?? ''
  const upstream = new URL(directUrl)
  const upstreamHost = upstream.hostname
  const upstreamPort = Number(upstream.port || 5432)
  const claimMarker = 'update "async_jobs" set "status"'
  let armed: ClaimFault | undefined
  let onFault: (() => void) | undefined

  const server = createServer((client) => {
    const db = connect(upstreamPort, upstreamHost)
    let dropNextAnswer = false
    const cut = () => {
      client.destroy()
      db.destroy()
      onFault?.()
    }
    client.on('data', (chunk) => {
      const fault = armed && chunk.includes(claimMarker) ? armed : undefined
      if (fault) armed = undefined
      if (fault === 'drop-before-send') return cut()
      if (fault === 'drop-answer') dropNextAnswer = true
      db.write(chunk)
    })
    db.on('data', (chunk) => {
      if (dropNextAnswer && chunk.includes('UPDATE 1')) return cut()
      client.write(chunk)
    })
    client.on('close', () => db.destroy())
    db.on('close', () => client.destroy())
    client.on('error', () => db.destroy())
    db.on('error', () => client.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('proxy has no port')

  upstream.hostname = '127.0.0.1'
  upstream.port = String(address.port)
  process.env.DATABASE_URL = upstream.toString()

  return {
    directUrl,
    arm(fault: ClaimFault): Promise<void> {
      armed = fault
      return new Promise((resolve) => {
        onFault = resolve
      })
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
})

const directClient = postgres(proxy.directUrl, { max: 1 })
const direct = drizzle(directClient)
const queue = new DatabaseJobQueue()

afterAll(async () => {
  await directClient.end()
  await proxy.close()
})

async function readJob(jobId: string): Promise<Job['status'] | undefined> {
  const [row] = await direct
    .select({ status: asyncJobs.status })
    .from(asyncJobs)
    .where(eq(asyncJobs.id, jobId))
  return row?.status as Job['status'] | undefined
}

async function settle(jobId: string): Promise<{ status?: string; attempts?: number }> {
  for (let i = 0; i < 100; i++) {
    const [row] = await direct
      .select({ status: asyncJobs.status, attempts: asyncJobs.attempts })
      .from(asyncJobs)
      .where(eq(asyncJobs.id, jobId))
    if (row && row.status !== 'pending' && row.status !== 'processing') return row
    await sleep(100)
  }
  const [row] = await direct
    .select({ status: asyncJobs.status, attempts: asyncJobs.attempts })
    .from(asyncJobs)
    .where(eq(asyncJobs.id, jobId))
  return row ?? {}
}

describe('inline job claim on a dropped Postgres connection', () => {
  it('runs the job once when the claim committed but its answer was lost', async () => {
    const runner = vi.fn(async () => ({ ran: true }))

    const fault = proxy.arm('drop-answer')
    const jobId = await queue.enqueue('webhook-execution', { case: 'drop-answer' }, { runner })
    await fault

    expect(await settle(jobId)).toEqual({ status: 'completed', attempts: 1 })
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('runs the job once when the connection dropped before the claim was sent', async () => {
    const runner = vi.fn(async () => ({ ran: true }))

    const fault = proxy.arm('drop-before-send')
    const jobId = await queue.enqueue('webhook-execution', { case: 'drop-before-send' }, { runner })
    await fault

    expect(await settle(jobId)).toEqual({ status: 'completed', attempts: 1 })
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('does not run a job another claimer took while this claim was retrying', async () => {
    const runner = vi.fn(async () => ({ ran: true }))

    const fault = proxy.arm('drop-before-send')
    const jobId = await queue.enqueue('webhook-execution', { case: 'other-claimer' }, { runner })
    await fault
    await direct
      .update(asyncJobs)
      .set({ status: 'processing', startedAt: new Date(Date.now() - 60_000) })
      .where(eq(asyncJobs.id, jobId))
    await sleep(3_000)

    expect(await readJob(jobId)).toBe('processing')
    expect(runner).not.toHaveBeenCalled()
  })
})
