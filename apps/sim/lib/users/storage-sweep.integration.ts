import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  copilotChats,
  outboxEvent,
  permissions,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { processOutboxEventById } from '@/lib/core/outbox/service'
import { UPLOAD_URL_TTL_MS } from '@/lib/uploads/upload-session/provider'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import { accountStorageSweepOutboxHandlers } from '@/lib/users/storage-sweep'
import {
  ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT,
  ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT,
} from '@/lib/users/storage-sweep-events'

readTestDatabaseUrl()

const storageRoot = mkdtempSync(join(tmpdir(), 'sim-account-storage-sweep-'))
setUploadDirServer(storageRoot)

const userIds: string[] = []
const workspaceIds: string[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

async function put(key: string, body = 'x'): Promise<void> {
  await mkdir(dirname(join(storageRoot, key)), { recursive: true })
  await writeFile(join(storageRoot, key), body)
}

async function exists(key: string): Promise<boolean> {
  try {
    await stat(join(storageRoot, key))
    return true
  } catch {
    return false
  }
}

async function insertUsers(ids: string[]) {
  userIds.push(...ids)
  await db.insert(user).values(
    ids.map((id) => ({
      id,
      name: 'Storage sweep fixture',
      email: `${id}@sweep.invalid`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
}

async function insertAdminWorkspace(id: string, ownerId: string) {
  workspaceIds.push(id)
  await insertWorkspaceFixture(db, {
    id,
    name: 'Storage sweep fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: id,
    permissionType: 'admin',
  })
}

function avatarUrl(key: string): string {
  return `/api/files/serve/${encodeURIComponent(key)}?context=profile-pictures`
}

function fileRow(values: {
  key: string
  userId: string
  workspaceId: string | null
  context: string
  chatId?: string
}) {
  return {
    id: generateId(),
    originalName: `fixture-${generateId()}.txt`,
    contentType: 'text/plain',
    sizeBytes: 1,
    chatId: values.chatId ?? null,
    ...values,
  }
}

/**
 * A departing account with a private workspace, and files it left in another person's workspace
 * after departing it: one handed to the workspace's billing account, one private chat attachment,
 * one attached to the other person's chat, and one with no workspace at all.
 */
async function seed() {
  const ownerId = generateId()
  const departingId = generateId()
  const doomedId = generateId()
  const survivingId = generateId()
  await insertUsers([ownerId, departingId])
  await insertAdminWorkspace(doomedId, departingId)
  await insertAdminWorkspace(survivingId, ownerId)
  const departingChatId = generateId()
  const ownerChatId = generateId()
  await db.insert(copilotChats).values([
    { id: departingChatId, userId: departingId, workspaceId: survivingId },
    { id: ownerChatId, userId: ownerId, workspaceId: survivingId },
  ])
  const keys = {
    doomedFile: `workspace/${doomedId}/${generateId()}.txt`,
    doomedCopilot: `copilot/${generateId()}/doomed.txt`,
    rowlessExecution: `execution/${doomedId}/wf/ex/large-value-lv_rowless.json`,
    rowlessSnapshot: `table-snapshots/${doomedId}/table/v1-hash.csv`,
    rowlessCompiled: `copilot-doc-compiled/${doomedId}/hash.pdf`,
    referencedElsewhere: `workspace/${doomedId}/moved-${generateId()}.txt`,
    neighbor: `workspace/${doomedId}x/keep.txt`,
    handedOff: `workspace/${survivingId}/${generateId()}.txt`,
    privateAttachment: `workspace/${survivingId}/${generateId()}/private.txt`,
    othersChatAttachment: `workspace/${survivingId}/${generateId()}/others.txt`,
    personalCopilot: `copilot/${generateId()}/personal.txt`,
    legacyWorkspacelessKb: `kb/${generateId()}-legacy.txt`,
    profilePictureRowLogo: `profile-pictures/${generateId()}/org-logo.png`,
    logoNamedByUrl: `workspace-logos/${doomedId}/${generateId()}-org-logo.png`,
    logoNamedByEncodedUrl: `workspace-logos/${doomedId}/${generateId()}-workspace-logo.png`,
    ownAvatar: `profile-pictures/${generateId()}-departing-avatar.png`,
    othersAvatar: `profile-pictures/${generateId()}-owner-avatar.png`,
  }
  await db.insert(workspaceFiles).values([
    fileRow({
      key: keys.doomedFile,
      userId: departingId,
      workspaceId: doomedId,
      context: 'workspace',
    }),
    fileRow({
      key: keys.doomedCopilot,
      userId: departingId,
      workspaceId: doomedId,
      context: 'copilot',
    }),
    fileRow({
      key: keys.referencedElsewhere,
      userId: ownerId,
      workspaceId: survivingId,
      context: 'workspace',
    }),
    fileRow({
      key: keys.handedOff,
      userId: departingId,
      workspaceId: survivingId,
      context: 'workspace',
    }),
    fileRow({
      key: keys.privateAttachment,
      userId: departingId,
      workspaceId: survivingId,
      context: 'mothership',
      chatId: departingChatId,
    }),
    fileRow({
      key: keys.othersChatAttachment,
      userId: departingId,
      workspaceId: survivingId,
      context: 'mothership',
      chatId: ownerChatId,
    }),
    fileRow({
      key: keys.personalCopilot,
      userId: departingId,
      workspaceId: null,
      context: 'copilot',
    }),
    fileRow({
      key: keys.legacyWorkspacelessKb,
      userId: departingId,
      workspaceId: null,
      context: 'knowledge-base',
    }),
    fileRow({
      key: keys.profilePictureRowLogo,
      userId: departingId,
      workspaceId: null,
      context: 'profile-pictures',
    }),
  ])
  await db
    .update(user)
    .set({ image: `/api/files/serve/${encodeURIComponent(keys.logoNamedByUrl)}` })
    .where(eq(user.id, ownerId))
  await db
    .update(workspace)
    .set({
      logoUrl: `/api/files/serve/s3/${encodeURIComponent(keys.logoNamedByEncodedUrl)}`,
    })
    .where(eq(workspace.id, survivingId))
  await db
    .update(user)
    .set({ image: avatarUrl(keys.ownAvatar) })
    .where(eq(user.id, departingId))
  for (const key of Object.values(keys)) await put(key)
  return { ownerId, departingId, doomedId, survivingId, keys }
}

function sweepEvents(workspaceId: string) {
  return db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT),
        sql`${outboxEvent.payload}->>'workspaceId' = ${workspaceId}`
      )
    )
}

function objectEvents(userId: string) {
  return db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT),
        sql`${outboxEvent.payload}->>'userId' = ${userId}`
      )
    )
}

async function runNow(eventIds: string[]) {
  for (const id of eventIds) {
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvent.id, id))
    expect(await processOutboxEventById(id, accountStorageSweepOutboxHandlers)).toBe('completed')
  }
}

describe('account deletion storage sweep', () => {
  check(
    'purges the deleted workspace by prefix and the account private files by key, keeping every live object',
    async () => {
      const f = await seed()
      const startedAt = Date.now()
      await deleteUserAccount(f.departingId, { recordIdentity: false })

      const sweeps = await sweepEvents(f.doomedId)
      const objects = await objectEvents(f.departingId)
      expect(sweeps).toHaveLength(1)
      expect(objects.length).toBeGreaterThan(0)
      for (const event of [...sweeps, ...objects]) {
        expect(event.availableAt.getTime()).toBeGreaterThanOrEqual(startedAt + UPLOAD_URL_TTL_MS)
        expect(await processOutboxEventById(event.id, accountStorageSweepOutboxHandlers)).toBe(
          'pending'
        )
      }
      const queuedKeys = objects.flatMap(
        (event) => (event.payload as { objects: { key: string }[] }).objects
      )
      expect(queuedKeys.map((object) => object.key)).not.toContain(f.keys.othersChatAttachment)
      expect(queuedKeys.map((object) => object.key)).not.toContain(f.keys.handedOff)
      expect(queuedKeys.map((object) => object.key)).not.toContain(f.keys.legacyWorkspacelessKb)
      expect(queuedKeys.map((object) => object.key)).not.toContain(f.keys.profilePictureRowLogo)

      const lateUpload = `workspace/${f.doomedId}/late-${generateId()}.bin`
      await put(lateUpload)
      await runNow([...sweeps, ...objects].map((event) => event.id))

      for (const key of [
        f.keys.doomedFile,
        f.keys.doomedCopilot,
        f.keys.rowlessExecution,
        f.keys.rowlessSnapshot,
        f.keys.rowlessCompiled,
        f.keys.personalCopilot,
        f.keys.ownAvatar,
        lateUpload,
      ])
        expect({ key, exists: await exists(key) }).toEqual({ key, exists: false })
      for (const key of [
        f.keys.referencedElsewhere,
        f.keys.neighbor,
        f.keys.handedOff,
        f.keys.othersChatAttachment,
        f.keys.privateAttachment,
        f.keys.legacyWorkspacelessKb,
        f.keys.profilePictureRowLogo,
        f.keys.logoNamedByUrl,
        f.keys.logoNamedByEncodedUrl,
        f.keys.othersAvatar,
      ])
        expect(await readFile(join(storageRoot, key), 'utf8')).toBe('x')
      expect(
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.key, f.keys.handedOff))
      ).toMatchObject([{ userId: f.ownerId }])
    }
  )

  check("keeps another account's avatar the departing image points at", async () => {
    const f = await seed()
    await db
      .update(user)
      .set({ image: avatarUrl(f.keys.othersAvatar) })
      .where(inArray(user.id, [f.ownerId, f.departingId]))
    await deleteUserAccount(f.departingId, { recordIdentity: false })

    await runNow((await objectEvents(f.departingId)).map((event) => event.id))

    expect(await readFile(join(storageRoot, f.keys.othersAvatar), 'utf8')).toBe('x')
  })

  check('a sweep for a workspace that exists again completes without deleting', async () => {
    const f = await seed()
    await deleteUserAccount(f.departingId, { recordIdentity: false })
    const [sweep] = await sweepEvents(f.doomedId)
    await insertAdminWorkspace(f.doomedId, f.ownerId)
    const restored = `workspace/${f.doomedId}/restored.txt`
    await put(restored)

    await runNow([sweep.id])

    expect(await readFile(join(storageRoot, restored), 'utf8')).toBe('x')
    expect(await readFile(join(storageRoot, f.keys.rowlessExecution), 'utf8')).toBe('x')
  })
})

afterAll(async () => {
  try {
    await db
      .delete(outboxEvent)
      .where(
        or(
          inArray(sql`${outboxEvent.payload}->>'workspaceId'`, workspaceIds),
          inArray(sql`${outboxEvent.payload}->>'userId'`, userIds)
        )
      )
    await db.delete(workspaceFiles).where(inArray(workspaceFiles.userId, userIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
    await db.delete(user).where(inArray(user.id, userIds))
    await rm(storageRoot, { recursive: true, force: true })
  } finally {
    const reportPath = process.env.ACCOUNT_STORAGE_SWEEP_REPORT_PATH
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    }
  }
})
