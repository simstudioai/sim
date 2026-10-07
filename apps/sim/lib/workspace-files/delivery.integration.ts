import { mkdtempSync } from 'node:fs'
import { mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import { permissions, user, userStats, workspace, workspaceFiles } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  markWorkspaceFileSecretProvenanceUnknown,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import * as storage from '@/lib/uploads/core/storage-service'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { downloadWorkspaceFileStream } from '@/lib/workspace-files/application/download-workspace-file'
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { readWorkspaceInlineFile } from '@/lib/workspace-files/application/read-workspace-inline-file'

const uploadRoot = mkdtempSync(join(tmpdir(), 'sim-delivery-test-'))
setUploadDirServer(uploadRoot)
const fixtures: { ownerId: string; editorId: string; workspaceId: string }[] = []
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
beforeEach(() => vi.restoreAllMocks())
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
  const ownerId = generateId()
  const editorId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values(
    [ownerId, editorId].map((id) => ({
      id,
      name: 'Delivery fixture',
      email: `${id}@delivery.invalid`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId,
    billedAccountUserId: ownerId,
    name: 'Delivery',
    workspaceMode: 'personal',
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: editorId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  fixtures.push({ ownerId, editorId, workspaceId })
  return { ownerId, editorId, workspaceId, principal: createSessionPrincipal({ userId: editorId }) }
}
describe('Workspace delivery against current PostgreSQL authority and local storage', () => {
  for (const mutation of ['membership', 'revision', 'deletion'] as const) {
    check(
      `workspace inline delivery cancels its opened stream after ${mutation} changes`,
      async () => {
        const f = await fixture()
        const file = await uploadWorkspaceFile(
          f.workspaceId,
          f.editorId,
          Buffer.alloc(1024 * 1024, 42),
          'image.png',
          'image/png',
          { notifyWorkspaceChange: false }
        )
        const open = storage.downloadFileStream
        let source: Awaited<ReturnType<typeof open>> | undefined
        vi.spyOn(storage, 'downloadFileStream').mockImplementationOnce(async (options) => {
          source = await open(options)
          if (mutation === 'membership') {
            await db
              .delete(permissions)
              .where(
                and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId))
              )
          } else {
            await db
              .update(workspaceFiles)
              .set(
                mutation === 'deletion'
                  ? { deletedAt: new Date() }
                  : { contentUpdatedAt: new Date(Date.now() + 1000) }
              )
              .where(eq(workspaceFiles.id, file.id))
          }
          return source
        })
        await expect(
          readWorkspaceInlineFile.execute({
            principal: f.principal,
            input: { workspaceId: f.workspaceId, fileId: file.id },
          })
        ).rejects.toBeInstanceOf(Error)
        expect(source?.destroyed).toBe(true)
      }
    )
  }
})

check(
  'downloads above the buffering ceiling stream incrementally and release storage on cancellation',
  async () => {
    const f = await fixture()
    const file = await uploadWorkspaceFile(
      f.workspaceId,
      f.editorId,
      Buffer.from('streamed'),
      'large.bin',
      'application/octet-stream',
      { notifyWorkspaceChange: false }
    )
    const size = MAX_BUFFERED_TRANSFER_BYTES + 1024
    await truncate(join(uploadRoot, file.key), size)
    await db.update(workspaceFiles).set({ sizeBytes: size }).where(eq(workspaceFiles.id, file.id))
    const open = storage.downloadFileStream
    let source: Awaited<ReturnType<typeof open>> | undefined
    vi.spyOn(storage, 'downloadFileStream').mockImplementationOnce(async (options) => {
      source = await open(options)
      return source
    })
    const result = await downloadWorkspaceFileStream.execute({
      principal: f.principal,
      input: { fileId: file.id },
    })
    expect(result.contentLength).toBe(size)
    const reader = result.stream.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(first.value?.length).toBeLessThan(size)
    await reader.cancel()
    expect(source?.destroyed).toBe(true)
  }
)

check(
  'same-revision provenance downgrade reaches the returned stream and delivery observer',
  async () => {
    const f = await fixture()
    const file = await uploadWorkspaceFile(
      f.workspaceId,
      f.editorId,
      Buffer.from('classification race'),
      'race.txt',
      'text/plain',
      { notifyWorkspaceChange: false, secretProvenance: { status: 'exact', entries: [] } }
    )
    const open = storage.downloadFileStream
    vi.spyOn(storage, 'downloadFileStream').mockImplementationOnce(async (options) => {
      const source = await open(options)
      await markWorkspaceFileSecretProvenanceUnknown(f.workspaceId, [file.id])
      return source
    })
    const observed: (WorkspaceFileSecretProvenance | undefined)[] = []
    const result = await observeWorkspaceFileDelivery(
      async (provenance) => {
        observed.push(provenance)
      },
      () =>
        downloadWorkspaceFileStream.execute({
          principal: f.principal,
          input: { fileId: file.id, includeSecretProvenance: true },
        })
    )
    await result.stream.cancel()
    const [current] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, file.id))
    expect(current.contentUpdatedAt).toEqual(file.contentUpdatedAt)
    expect({ returned: result.secretProvenance, observed: observed.at(-1) }).toEqual({
      returned: { status: 'unknown' },
      observed: { status: 'unknown' },
    })
  }
)

afterAll(async () => {
  for (const fixture of fixtures) {
    await deleteWorkspaceFixture(db, eq(workspace.id, fixture.workspaceId))
    await db.delete(user).where(inArray(user.id, [fixture.ownerId, fixture.editorId]))
  }
  await rm(uploadRoot, { recursive: true, force: true })
  const report = process.env.FILE_DELIVERY_INTEGRATION_REPORT_PATH
  if (report) {
    await mkdir(dirname(report), { recursive: true })
    await writeFile(report, JSON.stringify({ checks }, null, 2))
  }
})
