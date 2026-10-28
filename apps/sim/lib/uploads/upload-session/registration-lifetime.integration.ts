import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import { uploadSession } from '@sim/db/schema'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { writeLocalPutObject } from '@/lib/uploads/upload-session/provider'
import {
  abortUploadSession,
  cleanupExpiredUploadSessions,
  createUploadSession,
  getOwnedUploadSession,
} from '@/lib/uploads/upload-session/service'

const storageRoot = mkdtempSync(join(tmpdir(), 'sim-upload-registration-'))
setUploadDirServer(storageRoot)
const uploadIds: string[] = []
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

async function fixture() {
  const created = await createUploadSession({
    purpose: 'profile_picture',
    userId: generateId(),
    fileName: 'test.png',
    contentType: 'image/png',
    fileSize: 4,
    localOrigin: 'http://localhost:3000',
  })
  uploadIds.push(created.id)
  await writeLocalPutObject({
    uploadId: created.id,
    key: created.finalKey,
    expectedSize: 4,
    contentType: created.contentType,
    metadata: {},
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('file'))
        controller.close()
      },
    }),
  })
  await db
    .update(uploadSession)
    .set({ status: 'finalizing', expiresAt: new Date(Date.now() - 1000) })
    .where(eq(uploadSession.id, created.id))
  return getOwnedUploadSession({ uploadId: created.id, uploadToken: created.uploadToken })
}

describe('registered upload byte lifetime', () => {
  check('a stale abort cannot claim a session after its file has been registered', async () => {
    const stale = await fixture()
    await db
      .update(uploadSession)
      .set({ completedFileId: generateId() })
      .where(eq(uploadSession.id, stale.id))
    await expect(abortUploadSession(stale)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(join(storageRoot, stale.finalKey), 'utf8')).toBe('file')
    const [current] = await db.select().from(uploadSession).where(eq(uploadSession.id, stale.id))
    expect(current.status).toBe('finalizing')
    expect(current.completedFileId).not.toBeNull()
  })

  check(
    'expiry rechecks registration when its candidate waits behind the committing transaction',
    async () => {
      const session = await fixture()
      const locked = createDeferred<void>()
      const release = createDeferred<void>()
      const holder = db.transaction(async (tx) => {
        await tx
          .select({ id: uploadSession.id })
          .from(uploadSession)
          .where(eq(uploadSession.id, session.id))
          .for('update')
        locked.resolve()
        await release.promise
        await tx
          .update(uploadSession)
          .set({ completedFileId: generateId() })
          .where(eq(uploadSession.id, session.id))
      })
      await locked.promise
      const cleanup = cleanupExpiredUploadSessions()
      try {
        let waiting = false
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await db.execute(
            sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'update "upload_session"%'`
          )
          if (rows.length) {
            waiting = true
            break
          }
          await sleep(10)
        }
        expect(
          waiting,
          'expiry must have selected the old candidate and be waiting to claim it'
        ).toBe(true)
      } finally {
        release.resolve()
        await holder
      }
      await cleanup
      expect(await readFile(join(storageRoot, session.finalKey), 'utf8')).toBe('file')
      const [current] = await db
        .select()
        .from(uploadSession)
        .where(eq(uploadSession.id, session.id))
      expect(current.status).toBe('finalizing')
      expect(current.completedFileId).not.toBeNull()
    }
  )
})

afterAll(async () => {
  const reportPath =
    process.env.UPLOAD_REGISTRATION_REPORT_PATH ?? 'test-results/upload-registration.json'
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify({ checks }, null, 2)}\n`)
  if (uploadIds.length) await db.delete(uploadSession).where(inArray(uploadSession.id, uploadIds))
  await rm(storageRoot, { recursive: true, force: true })
  await db.$client.end()
})
