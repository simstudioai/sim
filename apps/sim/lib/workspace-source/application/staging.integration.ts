/**
 * Real PostgreSQL (and local object storage) coverage for staging workspace source blobs: the
 * use cases a client calls before an apply (`stageSourceBlobs`, `findMissingSourceBlobs`), the
 * caps and scope they enforce, and the sweep that removes what expired. Rows and objects are read
 * directly, so "nothing was staged" means no row and no object. Writes a report to
 * `WORKSPACE_SOURCE_STAGING_REPORT_PATH`.
 */
import { chmodSync, existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { user, userStats, workspaceSourceStagedBlob } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import {
  resetUploadsSetupMock,
  setUploadDirServer,
  uploadsSetupMock,
} from '@sim/testing/mocks/uploads-setup.mock'
import { generateId } from '@sim/utils/id'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
/** While `fail` is set, the payer quota check reads its counter through a connection that errors. */
const quotaReads = vi.hoisted(() => ({ fail: false }))
vi.mock('@/lib/billing/storage/limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/storage/limits')>()
  return {
    ...actual,
    checkStorageQuotaForBillingContext: (
      ...[context, bytes, executor]: Parameters<typeof actual.checkStorageQuotaForBillingContext>
    ) =>
      actual.checkStorageQuotaForBillingContext(
        context,
        bytes,
        quotaReads.fail && executor
          ? new Proxy(executor, {
              get(target, property) {
                if (property === 'select') throw new Error('Connection terminated unexpectedly')
                return Reflect.get(target, property)
              },
            })
          : executor
      ),
  }
})

/**
 * While `stalePayer` is set, staging resolves its payer as that user, as a payer transfer that
 * lands between the resolve and the staging transaction leaves it.
 */
const payers = vi.hoisted(() => ({ stalePayer: null as string | null }))
vi.mock('@/lib/billing/storage/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/storage/context')>()
  return {
    ...actual,
    resolveStorageBillingContext: async (
      ...args: Parameters<typeof actual.resolveStorageBillingContext>
    ) => {
      const context = await actual.resolveStorageBillingContext(...args)
      const stale = payers.stalePayer
      return stale === null
        ? context
        : {
            ...context,
            billedAccountUserId: stale,
            billingEntity: { type: 'user' as const, id: stale },
          }
    },
  }
})
/** While `fail` is set, reading the bytes staged against a payer's quota errors. */
const stagedReads = vi.hoisted(() => ({ fail: false }))
vi.mock('@/lib/billing/core/payer-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/core/payer-context')>()
  return {
    ...actual,
    workspacesPaidBy: (...args: Parameters<typeof actual.workspacesPaidBy>) => {
      if (stagedReads.fail) throw new Error('Connection terminated unexpectedly')
      return actual.workspacesPaidBy(...args)
    },
  }
})

import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import {
  findMissingSourceBlobs,
  stageSourceBlobs,
  stagingScopeOf,
} from '@/lib/workspace-source/application/stage-blobs'
import {
  blobManifest,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'
import {
  markStagedBlobsConsumed,
  sweepExpiredStagedBlobs,
} from '@/lib/workspace-source/staging/store'

let storageRoot = ''
const ownerId = generateId()
const writerId = generateId()
const readerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const writer = createSessionPrincipal({ userId: writerId, sessionId: generateId() })
const reader = createSessionPrincipal({ userId: readerId, sessionId: generateId() })
/** A payer of its own, so no other check's staged bytes count toward its storage quota. */
const payerId = generateId()
const payer = createSessionPrincipal({ userId: payerId, sessionId: generateId() })
/** A second payer of its own, whose stored bytes an apply changes. */
const applierId = generateId()
const applier = createSessionPrincipal({ userId: applierId, sessionId: generateId() })
/** A third payer of its own, near its quota. */
const renewerId = generateId()
const renewer = createSessionPrincipal({ userId: renewerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_STAGING_REPORT_PATH',
  'workspace-source-staging.json'
)
const workspaces = sourceWorkspaces()

async function newWorkspace(): Promise<string> {
  return workspaces.create({
    name: 'Workspace source staging',
    ownerId,
    members: [
      { userId: writerId, permission: 'write' },
      { userId: readerId, permission: 'read' },
    ],
  })
}

function blob(text: string) {
  const content = Buffer.from(text)
  return { sha256: sha256Hex(content), size: content.byteLength, content }
}

function stage(principal: Principal, workspaceId: string, blobs: Array<ReturnType<typeof blob>>) {
  return withPermissionGroupScope(() =>
    stageSourceBlobs.execute({
      principal,
      input: {
        workspaceId,
        blobs: blobs.map(({ sha256, content }) => ({ sha256, content })),
      },
    })
  )
}

async function missing(
  principal: Principal,
  workspaceId: string,
  blobs: Array<ReturnType<typeof blob>>
): Promise<string[]> {
  const result = await withPermissionGroupScope(() =>
    findMissingSourceBlobs.execute({
      principal,
      input: { workspaceId, blobs: blobs.map(({ sha256, size }) => ({ sha256, size })) },
    })
  )
  return result.missing
}

/** The workspace's staging rows, read directly. */
async function rows(workspaceId: string) {
  return db
    .select({
      scope: workspaceSourceStagedBlob.scope,
      sha256: workspaceSourceStagedBlob.sha256,
      storageKey: workspaceSourceStagedBlob.storageKey,
      consumedAt: workspaceSourceStagedBlob.consumedAt,
    })
    .from(workspaceSourceStagedBlob)
    .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
}

/** Every object stored under the workspace's prefix (empty folders left behind do not count). */
function objectsUnder(workspaceId: string): string[] {
  const root = path.join(storageRoot, 'workspace', workspaceId)
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

function stored(storageKey: string): boolean {
  return existsSync(path.join(storageRoot, storageKey))
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected a refusal')
    },
    (error: unknown) => error
  )
}

beforeAll(async () => {
  storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-workspace-source-staging-'))
  setUploadDirServer(storageRoot)
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, writerId, readerId, payerId, applierId, renewerId].map((id) => ({
      id,
      name: 'Workspace source staging fixture',
      email: `${id}@workspace-source.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
})

afterAll(async () => {
  await writeReport()
  resetUploadsSetupMock()
  await workspaces.cleanup()
  await db
    .delete(user)
    .where(inArray(user.id, [ownerId, writerId, readerId, payerId, applierId, renewerId]))
  await rm(storageRoot, { recursive: true, force: true })
})

describe('workspace source staging', () => {
  check(
    'a resumed upload asks first and sends only the blobs not yet staged; staging again renews',
    async () => {
      const workspaceId = await newWorkspace()
      const [a, b, c] = [blob('alpha'), blob('bravo'), blob('charlie')]

      await stage(owner, workspaceId, [a])
      expect(await missing(owner, workspaceId, [a, b, c])).toEqual([b.sha256, c.sha256])
      await stage(owner, workspaceId, [b, c])
      expect(await missing(owner, workspaceId, [a, b, c])).toEqual([])

      const restaged = await stage(owner, workspaceId, [a])
      expect(restaged.staged).toEqual([{ sha256: a.sha256, size: a.size }])
      const held = await rows(workspaceId)
      expect(held).toHaveLength(3)
      for (const row of held) expect(stored(row.storageKey)).toBe(true)
    }
  )

  check(
    'asking what is missing never renews a staged blob: one about to expire reads as missing until its bytes are staged again',
    async () => {
      const workspaceId = await newWorkspace()
      const a = blob('expiring alpha')
      await stage(owner, workspaceId, [a])
      const soon = new Date(Date.now() + 30 * 60 * 1000)
      await db
        .update(workspaceSourceStagedBlob)
        .set({ expiresAt: soon })
        .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
      const expiryOf = async () =>
        (
          await db
            .select({ expiresAt: workspaceSourceStagedBlob.expiresAt })
            .from(workspaceSourceStagedBlob)
            .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
        ).map((row) => row.expiresAt.getTime())

      expect(await missing(owner, workspaceId, [a])).toEqual([a.sha256])
      expect(await expiryOf()).toEqual([soon.getTime()])

      await stage(owner, workspaceId, [a])
      expect(await missing(owner, workspaceId, [a])).toEqual([])
      const [renewed] = await expiryOf()
      expect(renewed).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
      expect(await rows(workspaceId)).toHaveLength(1)
    }
  )

  check(
    "staging counts against the payer's storage quota, across the payer's workspaces, on top of what it stores",
    async () => {
      const quota = 1024 ** 3
      await db
        .insert(userStats)
        .values({ id: generateId(), userId: payerId, storageUsedBytes: quota - 10 })
      const create = () => workspaces.create({ name: 'Staging quota', ownerId: payerId })
      const [first, second] = [await create(), await create()]
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      try {
        await stage(payer, first, [blob('six b1')])
        const refused = await failure(stage(payer, second, [blob('six b2')]))
        expect(refused).toMatchObject({
          code: 'payload_too_large',
          name: 'SourceStagingFullError',
        })
        expect(await rows(second)).toEqual([])
        expect(objectsUnder(second)).toEqual([])
      } finally {
        vi.unstubAllEnvs()
      }
    }
  )

  check(
    'a blob an apply wrote stops counting toward the quota, since the workspace now stores it; staging it again counts it again, refused when the quota has no room',
    async () => {
      const quota = 1024 ** 3
      await db
        .insert(userStats)
        .values({ id: generateId(), userId: applierId, storageUsedBytes: quota - 20 })
      const workspaceId = await workspaces.create({ name: 'Staging consumed', ownerId: applierId })
      const notes = Buffer.from('twelve bytes')
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      try {
        const applied = await sourceRunner(['file'], applier).apply(workspaceId, {
          files: {},
          blobs: blobManifest({ 'files/notes.txt': notes }, () => true),
        })
        expect(applied.failed).toBeUndefined()
        const [usage] = await db
          .select({ storageUsedBytes: userStats.storageUsedBytes })
          .from(userStats)
          .where(eq(userStats.userId, applierId))
        expect(usage.storageUsedBytes).toBe(quota - 20 + notes.byteLength)

        // Stored 8 short of the quota: 6 more fit, unless the 12 applied bytes count twice.
        const six = blob('six b3')
        await stage(applier, workspaceId, [six])

        const restaged = { sha256: sha256Hex(notes), size: notes.byteLength, content: notes }
        const refused = await failure(stage(applier, workspaceId, [restaged]))
        expect(refused).toMatchObject({ name: 'SourceStagingFullError' })
        const [consumedNotes] = (await rows(workspaceId)).filter(
          (row) => row.sha256 === restaged.sha256
        )
        expect(consumedNotes.consumedAt).toBeInstanceOf(Date)

        // Renewing a blob that still counts adds nothing, so it fits with 2 bytes left.
        expect((await stage(applier, workspaceId, [six])).staged).toEqual([
          { sha256: six.sha256, size: six.size },
        ])
        // Room left for exactly the notes: staging them again takes it, so 1 byte more is refused.
        await db
          .update(userStats)
          .set({ storageUsedBytes: quota - six.size - restaged.size })
          .where(eq(userStats.userId, applierId))
        await stage(applier, workspaceId, [restaged])
        expect(await failure(stage(applier, workspaceId, [blob('1')]))).toMatchObject({
          name: 'SourceStagingFullError',
        })
      } finally {
        vi.unstubAllEnvs()
      }
    }
  )

  check(
    'a batch whose new blobs the quota refuses still renews the staged blobs it re-sent',
    async () => {
      const quota = 1024 ** 3
      await db
        .insert(userStats)
        .values({ id: generateId(), userId: renewerId, storageUsedBytes: quota - 10 })
      const workspaceId = await workspaces.create({ name: 'Staging renewal', ownerId: renewerId })
      const kept = blob('five5')
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      try {
        await stage(renewer, workspaceId, [kept])
        const soon = new Date(Date.now() + 30 * 60 * 1000)
        await db
          .update(workspaceSourceStagedBlob)
          .set({ expiresAt: soon })
          .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))

        const refused = await failure(stage(renewer, workspaceId, [kept, blob('six b4')]))
        expect(refused).toMatchObject({ name: 'SourceStagingFullError' })

        const [row] = await db
          .select({ expiresAt: workspaceSourceStagedBlob.expiresAt })
          .from(workspaceSourceStagedBlob)
          .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
        expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
      } finally {
        vi.unstubAllEnvs()
      }
    }
  )

  check(
    'a quota that cannot be read refuses staging as unavailable, never as a full staging area',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Staging quota down', ownerId: payerId })
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      quotaReads.fail = true
      try {
        const refused = await failure(stage(payer, workspaceId, [blob('quota down')]))
        expect(refused).toMatchObject({ code: 'unavailable' })
        expect(refused).not.toMatchObject({ name: 'SourceStagingFullError' })
        expect(await rows(workspaceId)).toEqual([])
        expect(objectsUnder(workspaceId)).toEqual([])
      } finally {
        quotaReads.fail = false
        vi.unstubAllEnvs()
      }
    }
  )

  check(
    'a payer that changed before the staging transaction refuses staging as unavailable, charging neither payer',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Staging payer moved', ownerId: payerId })
      // The payer the workspace moved away from, with room to spare: only the move refuses.
      await db.insert(userStats).values({ id: generateId(), userId: ownerId })
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      payers.stalePayer = ownerId
      try {
        const refused = await failure(stage(payer, workspaceId, [blob('payer moved')]))
        expect(refused).toMatchObject({ code: 'unavailable' })
        expect(await rows(workspaceId)).toEqual([])
        expect(objectsUnder(workspaceId)).toEqual([])
      } finally {
        payers.stalePayer = null
        vi.unstubAllEnvs()
      }
    }
  )

  check(
    'staged bytes that cannot be read refuse staging as unavailable, never as a full staging area',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Staged read down', ownerId: payerId })
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      stagedReads.fail = true
      try {
        const refused = await failure(stage(payer, workspaceId, [blob('staged read down')]))
        expect(refused).toMatchObject({ code: 'unavailable' })
        expect(await rows(workspaceId)).toEqual([])
      } finally {
        stagedReads.fail = false
        vi.unstubAllEnvs()
      }
    }
  )

  check(
    'an apply marks consumed only the staged copy it read, not one staged again in its place after it expired',
    async () => {
      const workspaceId = await newWorkspace()
      const a = blob('replaced alpha')
      await stage(owner, workspaceId, [a])
      const [read] = await rows(workspaceId)
      await db
        .update(workspaceSourceStagedBlob)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
      await stage(owner, workspaceId, [a])

      await markStagedBlobsConsumed(stagingScopeOf(owner, workspaceId), [
        { sha256: a.sha256, size: a.size, storageKey: read.storageKey },
      ])

      const held = await rows(workspaceId)
      expect(held).toHaveLength(1)
      expect(held[0].storageKey).not.toBe(read.storageKey)
      expect(held[0].consumedAt).toBeNull()
    }
  )

  check('bytes that do not hash to their name refuse the whole batch, nothing stored', async () => {
    const workspaceId = await newWorkspace()
    const good = blob('good bytes')
    const forged = { ...blob('declared bytes'), content: Buffer.from('other bytes') }

    const refused = await failure(stage(owner, workspaceId, [good, forged]))

    expect(refused).toMatchObject({ code: 'validation' })
    expect(await rows(workspaceId)).toEqual([])
    expect(objectsUnder(workspaceId)).toEqual([])
  })

  check('staging past the per-caller file or byte cap is refused and stores nothing', async () => {
    const workspaceId = await newWorkspace()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    const scope = `user:${ownerId}`
    await db.execute(sql`
      INSERT INTO workspace_source_staged_blob (id, workspace_id, scope, sha256, size, storage_key, expires_at)
      SELECT md5(random()::text), ${workspaceId}, ${scope}, lpad(to_hex(n), 64, '0'), 1, 'seeded', ${expiresAt.toISOString()}::timestamp
      FROM generate_series(1, ${WORKSPACE_SOURCE_LIMITS.maxStagedBlobs}) AS n
    `)

    const overCount = await failure(stage(owner, workspaceId, [blob('one too many')]))
    expect(overCount).toMatchObject({ code: 'payload_too_large' })
    expect(await rows(workspaceId)).toHaveLength(WORKSPACE_SOURCE_LIMITS.maxStagedBlobs)

    await db
      .delete(workspaceSourceStagedBlob)
      .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
    const half = Math.ceil(WORKSPACE_SOURCE_LIMITS.maxStagedBytes / 2)
    await db.insert(workspaceSourceStagedBlob).values(
      ['big-a', 'big-b'].map((name) => ({
        id: generateId(),
        workspaceId,
        scope,
        sha256: sha256Hex(name),
        size: half,
        storageKey: 'seeded',
        expiresAt,
      }))
    )

    const overBytes = await failure(stage(owner, workspaceId, [blob('one byte too many')]))
    expect(overBytes).toMatchObject({ code: 'payload_too_large' })
    expect(await rows(workspaceId)).toHaveLength(2)
    expect(objectsUnder(workspaceId)).toEqual([])

    // Another caller has its own room.
    await stage(writer, workspaceId, [blob('the writer has room')])
  })

  check(
    'staging is per caller: another member does not see it, and a read-only member may not stage',
    async () => {
      const workspaceId = await newWorkspace()
      const shared = blob('only the owner staged this')
      await stage(owner, workspaceId, [shared])

      expect(await missing(writer, workspaceId, [shared])).toEqual([shared.sha256])
      expect(await missing(owner, workspaceId, [shared])).toEqual([])

      const refused = await failure(stage(reader, workspaceId, [blob('reader bytes')]))
      expect(refused).toMatchObject({ code: 'forbidden' })
      expect((await rows(workspaceId)).map((row) => row.scope)).toEqual([`user:${ownerId}`])
    }
  )

  check(
    'an expired blob reads as missing, and the sweep deletes its row and its object',
    async () => {
      const workspaceId = await newWorkspace()
      const old = blob('expired bytes')
      const fresh = blob('fresh bytes')
      await stage(owner, workspaceId, [old, fresh])
      await db
        .update(workspaceSourceStagedBlob)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(
          and(
            eq(workspaceSourceStagedBlob.workspaceId, workspaceId),
            eq(workspaceSourceStagedBlob.sha256, old.sha256)
          )
        )
      const [expiredRow] = (await rows(workspaceId)).filter((row) => row.sha256 === old.sha256)

      expect(await missing(owner, workspaceId, [old, fresh])).toEqual([old.sha256])
      expect(await sweepExpiredStagedBlobs()).toBeGreaterThanOrEqual(1)

      const left = await rows(workspaceId)
      expect(left.map((row) => row.sha256)).toEqual([fresh.sha256])
      expect(stored(expiredRow.storageKey)).toBe(false)
      expect(stored(left[0].storageKey)).toBe(true)
    }
  )

  check(
    'an expired blob whose object cannot be removed keeps its row, so a later sweep removes both',
    async () => {
      const workspaceId = await newWorkspace()
      const old = blob('undeletable bytes')
      await stage(owner, workspaceId, [old])
      await db
        .update(workspaceSourceStagedBlob)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
      const [row] = await rows(workspaceId)
      const folder = path.dirname(path.join(storageRoot, row.storageKey))
      // A folder its objects cannot be unlinked from: storage refusing the delete.
      chmodSync(folder, 0o555)
      try {
        await sweepExpiredStagedBlobs()
      } finally {
        chmodSync(folder, 0o755)
      }
      expect((await rows(workspaceId)).map((left) => left.storageKey)).toEqual([row.storageKey])
      expect(stored(row.storageKey)).toBe(true)

      await sweepExpiredStagedBlobs()

      expect(await rows(workspaceId)).toEqual([])
      expect(stored(row.storageKey)).toBe(false)
    }
  )

  check(
    'a blob kept by one sweep is removed by the next even when both start in the same millisecond',
    async () => {
      const workspaceId = await newWorkspace()
      await stage(owner, workspaceId, [blob('kept within one millisecond')])
      await db
        .update(workspaceSourceStagedBlob)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
      const [row] = await rows(workspaceId)
      const folder = path.dirname(path.join(storageRoot, row.storageKey))
      // Only Date is faked: both sweeps read one start time, as back-to-back sweeps on a fast
      // database can.
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
      try {
        chmodSync(folder, 0o555)
        try {
          await sweepExpiredStagedBlobs()
        } finally {
          chmodSync(folder, 0o755)
        }
        expect((await rows(workspaceId)).map((left) => left.storageKey)).toEqual([row.storageKey])

        await sweepExpiredStagedBlobs()
      } finally {
        vi.useRealTimers()
      }

      expect(await rows(workspaceId)).toEqual([])
      expect(stored(row.storageKey)).toBe(false)
    }
  )
})
