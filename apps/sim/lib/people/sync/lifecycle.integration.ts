import { db } from '@sim/db'
import {
  auditLog,
  peopleDirectoryScimChange as change,
  peopleDirectoryEntry as entry,
  member,
  organization,
  scimConnection,
  scimCredential,
  scimUser,
  peopleDirectorySync as sync,
  user,
} from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { count, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { lockProfiles } from '@/lib/people/repository'
import { runDirectorySync, syncDueDirectories } from '@/lib/people/sync/runner'
import {
  configureDirectorySync,
  getDirectorySync,
  requestDirectorySync,
} from '@/lib/people/sync/service'
import { configureScimConnection } from '@/ee/scim/lib/application/admin/connection'
import { authenticateScimRequest, generateScimToken } from '@/ee/scim/lib/authenticate'

vi.hoisted(() => {
  vi.stubEnv('PEOPLE', 'true')
  vi.stubEnv('SCIM_ENABLED', 'true')
})

const organizationId = generateId()
const actorId = generateId()
const connectionId = generateId()
const personId = generateId()
const principal = createSessionPrincipal({ userId: actorId })
const observer = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => {} })
let auditWrites = 0
const setStatus = async (status: 'active' | 'disabled') => {
  const result = await configureScimConnection.execute({
    principal,
    input: { organizationId, status },
  })
  auditWrites++
  return result
}
const published = () => db.select().from(entry).where(eq(entry.organizationId, organizationId))

beforeAll(async () => {
  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id: organizationId,
      name: 'SCIM lifecycle',
      slug: organizationId,
      createdAt: new Date(),
    })
    await tx.insert(user).values({
      id: actorId,
      name: 'Original name',
      email: `${actorId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await tx
      .insert(member)
      .values({ id: generateId(), userId: actorId, organizationId, role: 'owner' })
    await tx.insert(scimConnection).values({ id: connectionId, organizationId })
    await tx.insert(scimUser).values({
      id: personId,
      connectionId,
      userId: actorId,
      externalId: 'directory-person',
      userName: `${actorId}@example.test`,
      orderKey: personId,
      attributes: {
        userName: `${actorId}@example.test`,
        active: true,
        name: { formatted: '' },
        emails: [],
      },
    })
  })
})
beforeEach(async () => {
  await setStatus('active')
  await db.update(user).set({ name: 'Original name' }).where(eq(user.id, actorId))
  await configureDirectorySync(organizationId, { source: 'scim' }, actorId)
})
afterAll(async () => {
  let cleanup: PromiseSettledResult<unknown>[] = []
  try {
    await vi.waitFor(async () => {
      const [row] = await db
        .select({ count: count() })
        .from(auditLog)
        .where(eq(auditLog.resourceId, connectionId))
      expect(row.count).toBe(auditWrites)
    })
  } finally {
    try {
      cleanup = await Promise.allSettled([
        db.delete(auditLog).where(eq(auditLog.resourceId, connectionId)),
        db.delete(organization).where(eq(organization.id, organizationId)),
      ])
    } finally {
      try {
        await db.delete(user).where(eq(user.id, actorId))
      } finally {
        await observer.end()
      }
    }
  }
  for (const result of cleanup) if (result.status === 'rejected') throw result.reason
})

it('pauses disabled SCIM without repeated attempts and wakes the same directory after re-enable', async () => {
  const baseline = await getDirectorySync(organizationId)
  const snapshot = await published()
  const historicalFailure = new Date('2026-01-01T00:00:00Z')
  await db
    .update(sync)
    .set({
      nextSyncAt: new Date(0),
      lastFailedAt: historicalFailure,
      lastError: 'Earlier failure',
    })
    .where(eq(sync.organizationId, organizationId))
  await setStatus('disabled')
  expect(await runDirectorySync(organizationId, 'cron')).toBe(false)
  expect(await requestDirectorySync(organizationId)).toMatchObject({
    state: 'paused',
    lastAttemptAt: baseline?.lastAttemptAt,
    lastSuccessAt: baseline?.lastSuccessAt,
    lastFailedAt: historicalFailure.toISOString(),
    lastError: 'Earlier failure',
    nextSyncAt: null,
    retryAt: null,
    retryBlocked: false,
    progress: null,
  })
  expect(await published()).toEqual(snapshot)

  await db.update(user).set({ name: 'Updated while paused' }).where(eq(user.id, actorId))
  await db
    .update(sync)
    .set({ nextSyncAt: new Date('2099-01-01') })
    .where(eq(sync.organizationId, organizationId))
  await setStatus('active')
  expect(await runDirectorySync(organizationId, 'cron')).toBe(true)
  expect(await getDirectorySync(organizationId)).toMatchObject({
    state: 'scheduled',
    lastError: null,
  })
  expect(await published()).toMatchObject([{ id: snapshot[0].id, name: 'Updated while paused' }])
})

it('pauses a worker claimed before disable without recording a new failure or publishing', async () => {
  const baseline = await getDirectorySync(organizationId)
  const snapshot = await published()
  const locked = createDeferred<void>()
  const release = createDeferred<void>()
  const blocker = db.transaction(async (tx) => {
    await lockProfiles(tx, organizationId)
    locked.resolve()
    await release.promise
  })
  let worker: Promise<unknown> | undefined
  let completed: PromiseSettledResult<unknown>[] = []
  try {
    await locked.promise
    worker = requestDirectorySync(organizationId)
    await expect
      .poll(async () => {
        const [row] = await db
          .select({ token: sync.leaseToken })
          .from(sync)
          .where(eq(sync.organizationId, organizationId))
        return row.token
      })
      .not.toBeNull()
    await setStatus('disabled')
  } finally {
    release.resolve()
    completed = await Promise.allSettled([blocker, worker])
  }
  for (const result of completed) if (result.status === 'rejected') throw result.reason
  expect(await getDirectorySync(organizationId)).toMatchObject({
    state: 'paused',
    lastSuccessAt: baseline?.lastSuccessAt,
    lastFailedAt: baseline?.lastFailedAt,
    lastError: baseline?.lastError,
    progress: null,
  })
  const [released] = await db
    .select({ token: sync.leaseToken, run: sync.runId })
    .from(sync)
    .where(eq(sync.organizationId, organizationId))
  expect(released).toEqual({ token: null, run: null })
  expect(await published()).toEqual(snapshot)
  await setStatus('active')
  expect(await runDirectorySync(organizationId, 'cron')).toBe(true)
  expect(await getDirectorySync(organizationId)).toMatchObject({ state: 'scheduled' })
})

it('serializes disable during SCIM publication without blocking provisioning authentication', async () => {
  const [person] = await published()
  const credentialId = generateId()
  const token = generateScimToken()
  await db.insert(scimCredential).values({
    id: credentialId,
    connectionId,
    tokenHash: token.hash,
    tokenPrefix: token.prefix,
    scopes: ['users:read'],
    lastUsedAt: new Date(),
  })
  await db
    .update(scimConnection)
    .set({ lastRequestAt: null })
    .where(eq(scimConnection.id, connectionId))
  const request = new NextRequest('http://localhost/api/scim/v2/Users', {
    headers: { authorization: `Bearer ${token.secret}` },
  })
  await authenticateScimRequest(request)
  await expect
    .poll(async () => {
      const [row] = await db
        .select({ activity: scimConnection.lastRequestAt })
        .from(scimConnection)
        .where(eq(scimConnection.id, connectionId))
      return row.activity
    })
    .not.toBeNull()
  await db
    .update(scimConnection)
    .set({ lastRequestAt: null })
    .where(eq(scimConnection.id, connectionId))
  const locked = createDeferred<number>()
  const release = createDeferred<void>()
  const blocker = db.transaction(async (tx) => {
    await tx.select({ id: entry.id }).from(entry).where(eq(entry.id, person.id)).for('update')
    const [session] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
    locked.resolve(session.pid)
    await release.promise
  })
  let worker: Promise<unknown> | undefined
  let disable: Promise<unknown> | undefined
  let authentication: Promise<void> | undefined
  let completed: PromiseSettledResult<unknown>[] = []
  try {
    const blockerPid = await locked.promise
    worker = requestDirectorySync(organizationId)
    let workerPid: number | undefined
    await expect
      .poll(async () => {
        const [session] = await db.execute<{ pid: number }>(sql`
        SELECT pid FROM pg_stat_activity WHERE ${blockerPid}=ANY(pg_blocking_pids(pid))`)
        workerPid = session?.pid
        return workerPid
      })
      .toBeTypeOf('number')
    authentication = (async () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        const principals = await Promise.all(
          Array.from({ length: db.$client.options.max + 1 }, () => authenticateScimRequest(request))
        )
        expect(principals.every((item) => item.connectionId === connectionId)).toBe(true)
      }
    })()
    let authenticationSettled = false
    void authentication.then(
      () => {
        authenticationSettled = true
      },
      () => {
        authenticationSettled = true
      }
    )
    let outcome = 'pending'
    await expect
      .poll(async () => {
        const [row] = await observer<{ blocked: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE ${workerPid ?? 0}=ANY(pg_blocking_pids(pid))
            AND query LIKE 'update "scim_connection" set "last_request_at"%') AS blocked`
        outcome = row.blocked ? 'blocked' : authenticationSettled ? 'completed' : 'pending'
        return outcome
      })
      .not.toBe('pending')
    expect(outcome).toBe('completed')
    await authentication
    disable = setStatus('disabled')
    await expect
      .poll(async () => {
        const [row] = await db.execute<{ settled: boolean }>(sql`
        SELECT status='disabled' OR EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE ${workerPid}=ANY(pg_blocking_pids(pid))) AS settled
        FROM ${scimConnection} WHERE id=${connectionId}`)
        return row.settled
      })
      .toBe(true)
    const [connection] = await db
      .select({ status: scimConnection.status })
      .from(scimConnection)
      .where(eq(scimConnection.id, connectionId))
    expect(connection.status).toBe('active')
  } finally {
    release.resolve()
    try {
      completed = await Promise.allSettled([blocker, worker, authentication, disable])
    } finally {
      await db.delete(scimCredential).where(eq(scimCredential.id, credentialId))
    }
  }
  for (const result of completed) if (result.status === 'rejected') throw result.reason
  expect(await getDirectorySync(organizationId)).toMatchObject({ state: 'paused', lastError: null })
})

it('does not let a full page of paused directories starve active scheduled or changed sources', async () => {
  const ids = Array.from({ length: 50 }, () => generateId())
  try {
    await db.transaction(async (tx) => {
      for (const id of ids) {
        const connection = generateId()
        await tx
          .insert(organization)
          .values({ id, name: 'Paused directory', slug: id, createdAt: new Date() })
        await tx
          .insert(scimConnection)
          .values({ id: connection, organizationId: id, status: 'disabled' })
        await tx.insert(sync).values({
          organizationId: id,
          source: 'scim',
          sourceTarget: connection,
          nextSyncAt: new Date(0),
        })
        await tx.insert(change).values({ organizationId: id, changedAt: new Date(0) })
      }
    })
    for (const changed of [false, true]) {
      await db
        .update(sync)
        .set({ nextSyncAt: new Date(changed ? '2099-01-01' : '2000-01-01') })
        .where(eq(sync.organizationId, organizationId))
      if (changed)
        await db.insert(change).values({ organizationId, changedAt: new Date('2000-01-01') })
      expect(await syncDueDirectories()).toEqual({ attempted: 1 })
      expect(await getDirectorySync(organizationId)).toMatchObject({ state: 'scheduled' })
    }
    const attempted = await db
      .select({ attempt: sync.lastAttemptAt })
      .from(sync)
      .where(inArray(sync.organizationId, ids))
    expect(attempted.every((row) => row.attempt === null)).toBe(true)
  } finally {
    await db.delete(organization).where(inArray(organization.id, ids))
  }
})
