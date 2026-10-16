/**
 * The inline job claim under a dropped connection, against real PostgreSQL. A TCP proxy between
 * the app's `db` client and Postgres cuts the connection on the claim `UPDATE`, either when its
 * `UPDATE 1` answer comes back (the claim committed; the answer is lost) or before sending it. Ingress has
 * already acknowledged the delivery by then, so the job must still run, exactly once.
 */
import { asyncJobs } from '@sim/db'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
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
  const answerMarker = 'UPDATE 1'
  let armed: ClaimFault | undefined
  let beforeCut: (() => Promise<void>) | undefined
  let onFault: (() => void) | undefined

  /** Matches a marker that TCP may have split across chunks by keeping the stream's tail. */
  const streamMatcher = (marker: string) => {
    let tail = ''
    return (chunk: Buffer) => {
      const seen = tail + chunk.toString('latin1')
      tail = seen.slice(-(marker.length - 1))
      return seen.includes(marker)
    }
  }

  const server = createServer((client) => {
    const db = connect(upstreamPort, upstreamHost)
    const sawClaim = streamMatcher(claimMarker)
    const sawAnswer = streamMatcher(answerMarker)
    let dropNextAnswer = false
    // A message is cut mid-way at most, so Postgres never runs (or the client never reads) it whole.
    const cut = async () => {
      client.pause()
      db.pause()
      await beforeCut?.()
      client.destroy()
      db.destroy()
      onFault?.()
    }
    client.on('data', (chunk) => {
      const fault = sawClaim(chunk) && armed ? armed : undefined
      if (fault) armed = undefined
      if (fault === 'drop-before-send') return void cut()
      if (fault === 'drop-answer') dropNextAnswer = true
      db.write(chunk)
    })
    db.on('data', (chunk) => {
      if (sawAnswer(chunk) && dropNextAnswer) return void cut()
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
    /** `then` runs before the cut, while the claim's connection is held open. */
    arm(fault: ClaimFault, then?: () => Promise<void>): Promise<void> {
      armed = fault
      beforeCut = then
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
const jobIds: string[] = []

async function enqueue(testCase: string, runner: () => Promise<unknown>): Promise<string> {
  const jobId = `inline-claim-faults-${generateId()}`
  jobIds.push(jobId)
  await queue.enqueue('webhook-execution', { case: testCase }, { jobId, runner })
  return jobId
}

afterAll(async () => {
  if (jobIds.length > 0) await direct.delete(asyncJobs).where(inArray(asyncJobs.id, jobIds))
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
    const jobId = await enqueue('drop-answer', runner)
    await fault

    expect(await settle(jobId)).toEqual({ status: 'completed', attempts: 1 })
    expect(runner).toHaveBeenCalledTimes(1)
    expect((await queue.getJob(jobId))?.metadata).not.toHaveProperty('claimToken')
  })

  it('runs the job once when the connection dropped before the claim was sent', async () => {
    const runner = vi.fn(async () => ({ ran: true }))

    const fault = proxy.arm('drop-before-send')
    const jobId = await enqueue('drop-before-send', runner)
    await fault

    expect(await settle(jobId)).toEqual({ status: 'completed', attempts: 1 })
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('does not run a job another claimer took while this claim was retrying', async () => {
    const runner = vi.fn(async () => ({ ran: true }))
    let jobId = ''

    // Another replica claims the same job id before this claim's dropped connection surfaces.
    const fault = proxy.arm('drop-before-send', async () => {
      await direct
        .update(asyncJobs)
        .set({ status: 'processing', startedAt: new Date(), attempts: 1 })
        .where(eq(asyncJobs.id, jobId))
    })
    jobId = `inline-claim-faults-${generateId()}`
    jobIds.push(jobId)
    await queue.enqueue('webhook-execution', { case: 'other-claimer' }, { jobId, runner })
    await fault
    await sleep(3_000)

    expect(await readJob(jobId)).toBe('processing')
    expect(runner).not.toHaveBeenCalled()
  })
})
