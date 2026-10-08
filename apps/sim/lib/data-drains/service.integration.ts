import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { db } from '@sim/db'
import {
  asyncJobs,
  auditLog,
  dataDrainRuns,
  dataDrains,
  member,
  organization,
  user,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetDestination } = vi.hoisted(() => ({ mockGetDestination: vi.fn() }))
vi.mock('@/lib/data-drains/destinations/registry', () => ({ getDestination: mockGetDestination }))
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

import { testDataDrain } from '@/lib/data-drains/application/use-cases'
import { dispatchDueDrains } from '@/lib/data-drains/dispatcher'
import { encryptCredentials } from '@/lib/data-drains/encryption'
import { enqueueDrain } from '@/lib/data-drains/enqueue'
import { runDrain } from '@/lib/data-drains/service'

const ids = { user: generateId(), organization: generateId() }
const checks: Array<{ name: string; status: string; durationMs: number }> = []
let drainId = ''
let fixtureDrainIds: string[] = []
let extraOrganizationIds: string[] = []
let testStartedAt = 0
let received: Array<Array<{ id: string }>> = []

async function seedRows(count: number, description?: string) {
  const createdAt = new Date(Date.now() - 10 * 60_000)
  await db.insert(auditLog).values(
    Array.from({ length: count }, (_, index) => ({
      id: `${drainId}-${index.toString().padStart(6, '0')}`,
      action: 'fixture.updated',
      resourceType: 'fixture',
      metadata: { organizationId: ids.organization },
      description,
      createdAt,
    }))
  )
}

async function drainRow() {
  const [row] = await db.select().from(dataDrains).where(eq(dataDrains.id, drainId))
  if (!row) throw new Error('Drain fixture disappeared')
  return row
}

function destination(deliver?: (rows: Array<{ id: string }>) => Promise<void>, close?: () => void) {
  return {
    configSchema: { parse: (value: unknown) => value },
    credentialsSchema: { parse: (value: unknown) => value },
    openSession: () => ({
      async deliver({ body }: { body: Buffer }) {
        const rows = body
          .toString('utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        await deliver?.(rows)
        received.push(rows)
        return { locator: `fixture://${drainId}/${received.length}` }
      },
      async close() {
        close?.()
      },
    }),
  }
}

beforeAll(async () => {
  await db.insert(user).values({
    id: ids.user,
    name: 'Drain integrity fixture',
    email: `${ids.user}@drain.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(organization).values({
    id: ids.organization,
    name: 'Drain integrity fixture',
    slug: ids.organization,
    createdAt: new Date(),
  })
  await db.insert(member).values({
    id: generateId(),
    organizationId: ids.organization,
    userId: ids.user,
    role: 'admin',
    createdAt: new Date(),
  })
})

beforeEach(async () => {
  testStartedAt = Date.now()
  drainId = generateId()
  fixtureDrainIds = [drainId]
  extraOrganizationIds = []
  received = []
  resetEnvFlagsMock()
  setEnvFlags({ isDataDrainsEnabled: true })
  billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
  mockGetDestination.mockReturnValue(destination())
  await db.insert(dataDrains).values({
    id: drainId,
    organizationId: ids.organization,
    name: drainId,
    source: 'audit_logs',
    destinationType: 'webhook',
    destinationConfig: {},
    destinationCredentials: await encryptCredentials({}),
    scheduleCadence: 'hourly',
    enabled: true,
    createdBy: ids.user,
  })
})

afterEach(async (context) => {
  checks.push({
    name: context.task.name,
    status: context.task.result?.state ?? 'unknown',
    durationMs: Date.now() - testStartedAt,
  })
  await db.delete(dataDrains).where(inArray(dataDrains.id, fixtureDrainIds))
  await db
    .delete(auditLog)
    .where(
      inArray(sql`${auditLog.metadata}->>'organizationId'`, [
        ids.organization,
        ...extraOrganizationIds,
      ])
    )
  if (extraOrganizationIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, extraOrganizationIds))
  }
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, ids.organization))
  await db.delete(user).where(eq(user.id, ids.user))
  const reportPath =
    process.env.DATA_DRAINS_REPORT_PATH ?? 'test-results/data-drains-integration.json'
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
})

describe('data drain durable delivery', () => {
  it('fails closed when malformed JSON credentials expose only a private-key fragment', async () => {
    await seedRows(1)
    const fragment = 'malformed-private-key-fragment-028f'
    await db
      .update(dataDrains)
      .set({
        destinationCredentials: await encryptCredentials({
          serviceAccountJson: `{"private_key":"${fragment}...`,
        }),
      })
      .where(eq(dataDrains.id, drainId))
    mockGetDestination.mockReturnValue(
      destination(async () => {
        throw new Error(`Invalid JSON near '${fragment}'`)
      })
    )
    const failure = await runDrain(drainId, 'cron').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected delivery failure')
    expect(failure.message).not.toContain(fragment)
    const [run] = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
    expect(run.status).toBe('failed')
    expect(run.error).not.toContain(fragment)
  })

  it('redacts saved credential values from persisted run failures and propagated errors', async () => {
    await seedRows(1)
    const bearerToken = 'drain-fixture-bearer-6a81'
    const privateKey = 'drain-fixture-private-key-94d2'
    await db
      .update(dataDrains)
      .set({
        destinationCredentials: await encryptCredentials({
          bearerToken,
          serviceAccountJson: JSON.stringify({ private_key: privateKey }),
        }),
      })
      .where(eq(dataDrains.id, drainId))
    mockGetDestination.mockReturnValue(
      destination(async () => {
        throw new Error(`HTTP 403 rejected credentials ${bearerToken} and ${privateKey}`)
      })
    )
    const failure = await runDrain(drainId, 'cron').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected delivery failure')
    expect(failure.message).toContain('HTTP 403')
    expect(failure.message).not.toContain(bearerToken)
    expect(failure.message).not.toContain(privateKey)
    const [run] = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
    expect(run.status).toBe('failed')
    expect(run.error).toContain('HTTP 403')
    expect(run.error).not.toContain(bearerToken)
    expect(run.error).not.toContain(privateKey)
    expect(run.error?.length).toBeLessThanOrEqual(4000)
  })

  it('redacts connection-test credential echoes from its response and organization audit', async () => {
    const bearerToken = 'connection-fixture-bearer-517d'
    const privateKey = 'connection-fixture-private-key-b719'
    await db
      .update(dataDrains)
      .set({
        destinationCredentials: await encryptCredentials({
          bearerToken,
          serviceAccountJson: JSON.stringify({ private_key: privateKey }),
        }),
      })
      .where(eq(dataDrains.id, drainId))
    mockGetDestination.mockReturnValue({
      ...destination(),
      async test() {
        throw new Error(`HTTP 401 rejected credentials ${bearerToken} and ${privateKey}`)
      },
    })
    const result = await testDataDrain.execute({
      principal: createSessionPrincipal({ userId: ids.user }),
      input: { organizationId: ids.organization, drainId },
    })
    expect(result.ok).toBe(false)
    const audit = await vi.waitFor(async () => {
      const [entry] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.resourceId, drainId), eq(auditLog.action, 'data_drain.tested')))
      expect(entry).toBeDefined()
      return entry
    })
    const persistedAndReturned = JSON.stringify({ result, metadata: audit.metadata })
    expect(persistedAndReturned).toContain('HTTP 401')
    expect(persistedAndReturned).not.toContain(bearerToken)
    expect(persistedAndReturned).not.toContain(privateKey)
  })

  it('admits one worker for the same drain while delivery is in flight', async () => {
    await seedRows(1)
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    let firstDelivery = true
    mockGetDestination.mockReturnValue(
      destination(async () => {
        if (!firstDelivery) return
        firstDelivery = false
        entered.resolve()
        await release.promise
      })
    )
    const first = runDrain(drainId, 'cron')
    await entered.promise
    try {
      const second = await runDrain(drainId, 'manual')
      expect(second.status).toBe('skipped')
      const runs = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
      expect(runs).toHaveLength(1)
    } finally {
      release.resolve()
      await first
    }
    expect(received.flat()).toHaveLength(1)
  })

  it('fences a worker whose running history has been reaped', async () => {
    await seedRows(1)
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    mockGetDestination.mockReturnValue(
      destination(async () => {
        entered.resolve()
        await release.promise
      })
    )
    const pending = runDrain(drainId, 'cron')
    await entered.promise
    await db
      .update(dataDrainRuns)
      .set({ status: 'failed', error: 'reaped' })
      .where(and(eq(dataDrainRuns.drainId, drainId), eq(dataDrainRuns.status, 'running')))
    release.resolve()
    await expect(pending).rejects.toThrow(/lease/i)
    expect((await drainRow()).cursor).toBeNull()
    const [run] = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
    expect(run.status).toBe('failed')
    expect(run.error).toBe('reaped')
  })

  it('keeps acknowledged progress when a later delivery fails', async () => {
    await seedRows(1001)
    let attempts = 0
    mockGetDestination.mockReturnValue(
      destination(async () => {
        if (++attempts === 2) throw new Error('destination unavailable')
      })
    )
    await expect(runDrain(drainId, 'cron')).rejects.toThrow('destination unavailable')
    const confirmedRows = received.flat()
    const confirmedLast = confirmedRows[confirmedRows.length - 1]
    expect(confirmedRows.length).toBeGreaterThan(0)
    expect(JSON.parse((await drainRow()).cursor ?? '{}').id).toBe(confirmedLast.id)
    const [run] = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
    expect(run.status).toBe('failed')
    expect(run.rowsExported).toBe(confirmedRows.length)
    expect(run.cursorAfter).toBe((await drainRow()).cursor)
  })

  it('stops a backlog at a bounded window and resumes without losing rows', async () => {
    await seedRows(10001)
    const first = await runDrain(drainId, 'cron')
    expect(first.rowsExported).toBeGreaterThan(0)
    expect(first.rowsExported).toBeLessThanOrEqual(10000)
    expect(first.locators.length).toBeLessThanOrEqual(100)
    for (let attempts = 0; attempts < 10 && received.flat().length < 10001; attempts++) {
      await runDrain(drainId, 'cron')
    }
    const deliveredIds = received.flat().map((row) => row.id)
    expect(deliveredIds).toHaveLength(10001)
    expect(new Set(deliveredIds).size).toBe(10001)
  }, 30_000)

  it('rejects an oversized record before destination delivery', async () => {
    await seedRows(1, 'x'.repeat(1024 * 1024 + 1))
    await expect(runDrain(drainId, 'cron')).rejects.toThrow(/record.*bytes|row.*bytes/i)
    expect(received).toHaveLength(0)
    expect((await drainRow()).cursor).toBeNull()
  })

  it('executes a dispatched drain through the database queue fallback', async () => {
    await seedRows(1)
    await dispatchDueDrains()
    await vi.waitFor(
      async () => {
        expect((await drainRow()).cursor).not.toBeNull()
        const [run] = await db
          .select()
          .from(dataDrainRuns)
          .where(eq(dataDrainRuns.drainId, drainId))
        expect(run.status).toBe('success')
      },
      { timeout: 3000 }
    )
    expect(received.flat()).toHaveLength(1)
  })

  it('marks the queued job failed when destination delivery fails', async () => {
    await seedRows(1)
    mockGetDestination.mockReturnValue(
      destination(async () => {
        throw new Error('destination unavailable')
      })
    )
    const jobId = await enqueueDrain(drainId, 'cron')
    await vi.waitFor(async () => {
      const [job] = await db.select().from(asyncJobs).where(eq(asyncJobs.id, jobId))
      expect(job.status).toBe('failed')
      expect(job.error).toContain('destination unavailable')
      const [run] = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
      expect(run.status).toBe('failed')
    })
    expect((await drainRow()).cursor).toBeNull()
    expect(received).toHaveLength(0)
  })

  it('claims a due drain once when dispatchers race', async () => {
    await seedRows(1)
    const now = new Date()
    const dispatches = await Promise.all([dispatchDueDrains(now), dispatchDueDrains(now)])
    expect(dispatches.reduce((total, dispatch) => total + dispatch.dispatched, 0)).toBe(1)
    await vi.waitFor(async () => {
      const [run] = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
      expect(run.status).toBe('success')
    })
    expect(received.flat()).toHaveLength(1)
  })

  it('bounds the database fallback to two active drains across organizations', async () => {
    await seedRows(1)
    const original = await drainRow()
    const extraIds = [generateId(), generateId()]
    extraOrganizationIds = [generateId(), generateId()]
    fixtureDrainIds.push(...extraIds)
    await db.insert(organization).values(
      extraOrganizationIds.map((id) => ({
        id,
        name: id,
        slug: id,
        createdAt: new Date(),
      }))
    )
    await db.insert(dataDrains).values(
      extraIds.map((id, index) => ({
        ...original,
        id,
        name: id,
        organizationId: extraOrganizationIds[index],
      }))
    )
    await db.insert(auditLog).values(
      extraOrganizationIds.map((organizationId) => ({
        id: generateId(),
        action: 'fixture.updated',
        resourceType: 'fixture',
        metadata: { organizationId },
        createdAt: new Date(Date.now() - 10 * 60_000),
      }))
    )
    const firstTwoEntered = createDeferred<void>()
    const thirdEntered = createDeferred<void>()
    const release = createDeferred<void>()
    let active = 0
    let entered = 0
    let peakActive = 0
    mockGetDestination.mockReturnValue(
      destination(async () => {
        entered++
        active++
        peakActive = Math.max(peakActive, active)
        if (entered === 2) firstTwoEntered.resolve()
        if (entered === 3) thirdEntered.resolve()
        await release.promise
        active--
      })
    )
    const jobs = await Promise.all([
      enqueueDrain(drainId, 'cron'),
      enqueueDrain(extraIds[0], 'cron'),
    ])
    await firstTwoEntered.promise
    jobs.push(await enqueueDrain(extraIds[1], 'cron'))
    try {
      const observation = await Promise.race([
        thirdEntered.promise.then(() => 'entered'),
        sleep(300).then(() => 'queued'),
      ])
      expect(observation).toBe('queued')
      expect(peakActive).toBe(2)
    } finally {
      release.resolve()
      await vi.waitFor(async () => {
        const rows = await db.select().from(asyncJobs).where(inArray(asyncJobs.id, jobs))
        expect(rows).toHaveLength(3)
        expect(rows.every((row) => row.status === 'completed')).toBe(true)
      })
    }
    expect(received.flat()).toHaveLength(3)
  })

  it('continues a queued backlog until every bounded window is delivered', async () => {
    await seedRows(10001)
    await dispatchDueDrains()
    await vi.waitFor(
      async () => {
        expect(received.flat()).toHaveLength(10001)
        const runs = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
        expect(runs.length).toBeGreaterThan(1)
        expect(runs.every((run) => run.status === 'success')).toBe(true)
      },
      { timeout: 10_000 }
    )
    expect(new Set(received.flat().map((row) => row.id)).size).toBe(10001)
  }, 30_000)

  it('rechecks an organization entitlement before a queued worker reads or delivers its data', async () => {
    await seedRows(1)
    setEnvFlags({ isBillingEnabled: true })
    billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)
    const result = await runDrain(drainId, 'cron')
    expect(result.status).toBe('skipped')
    expect(received).toHaveLength(0)
    expect((await drainRow()).cursor).toBeNull()
    expect(
      await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
    ).toHaveLength(0)
  })

  it('closes its session and keeps the acknowledged checkpoint when cancellation arrives after delivery', async () => {
    await seedRows(1)
    const controller = new AbortController()
    let closed = false
    mockGetDestination.mockReturnValue(
      destination(
        async () => controller.abort(),
        () => {
          closed = true
        }
      )
    )
    await expect(runDrain(drainId, 'cron', { signal: controller.signal })).rejects.toThrow(
      /cancelled|aborted/i
    )
    expect(closed).toBe(true)
    expect(received.flat()).toHaveLength(1)
    expect(JSON.parse((await drainRow()).cursor ?? '{}').id).toBe(received[0][0].id)
    const [run] = await db.select().from(dataDrainRuns).where(eq(dataDrainRuns.drainId, drainId))
    expect(run.status).toBe('failed')
  })

  it('preserves successful delivery when releasing the destination session fails', async () => {
    await seedRows(1)
    mockGetDestination.mockReturnValue(
      destination(undefined, () => {
        throw new Error('close failed')
      })
    )
    const result = await runDrain(drainId, 'cron')
    expect(result.status).toBe('success')
    expect(received.flat()).toHaveLength(1)
    expect((await drainRow()).cursor).toBe(result.cursorAfter)
  })
})
