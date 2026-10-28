import { mkdtempSync } from 'node:fs'
import { mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  changelogRelease,
  permissions,
  user,
  userStats,
  workflowTest,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import {
  type ContentProvenance,
  observeContentDelivery,
  runWorkflowOutsideContentDelivery,
} from '@/lib/core/application'
import {
  createOwnedWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { markWorkspaceFileSecretProvenanceUnknown } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import * as storage from '@/lib/uploads/core/storage-service'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { hydrateUserFilesWithBase64 } from '@/lib/uploads/utils/user-file-base64.server'
import { downloadWorkspaceFileStream } from '@/lib/workspace-files/application/download-workspace-file'
import { readWorkspaceInlineFile } from '@/lib/workspace-files/application/read-workspace-inline-file'
import { createFileReadReceipt, recheckFileReadReceipt } from '@/lib/workspace-files/read-receipt'
import type { UserFile } from '@/executor/types'

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

describe('Rendered input receipts preserve owned-file eligibility', () => {
  for (const context of ['test', 'changelog'] as const) {
    for (const mutation of ['owner-deletion', 'foreign-workspace', 'revision', 'key'] as const) {
      check(`${context} input receipt accepts its live owner and rejects ${mutation}`, async () => {
        const f = await fixture()
        const foreign = mutation === 'foreign-workspace' ? await fixture() : undefined
        const body = await createOwnedWorkspaceFile({
          context,
          workspaceId: f.workspaceId,
          userId: f.ownerId,
          content: 'owned delivery input',
          contentType: 'text/plain',
          fileName: (id) => `${id}.txt`,
          insertOwner: async (tx, bodyFileId) => {
            if (context === 'test')
              await tx.insert(workflowTest).values({
                id: generateId(),
                workspaceId: f.workspaceId,
                name: generateId(),
                title: 'Delivery input',
                bodyFileId,
                sourceHash: 'fixture',
              })
            else
              await tx.insert(changelogRelease).values({
                id: generateId(),
                workspaceId: f.workspaceId,
                title: 'Delivery input',
                bodyFileId,
                versionMajor: 1,
                versionMinor: 0,
                versionPatch: 0,
                bumpReason: 'fixture',
              })
          },
        })
        const [file] = await db
          .select()
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, body.fileId))
        const receipt = createFileReadReceipt(
          { entityType: 'workspace', entityId: f.workspaceId },
          [file]
        )
        await expect(
          db.transaction((tx) => recheckFileReadReceipt(tx, receipt))
        ).resolves.toBeDefined()
        if (mutation === 'owner-deletion') {
          if (context === 'test')
            await db
              .update(workflowTest)
              .set({ deletedAt: new Date() })
              .where(eq(workflowTest.bodyFileId, body.fileId))
          else await db.delete(changelogRelease).where(eq(changelogRelease.bodyFileId, body.fileId))
        } else if (mutation === 'foreign-workspace') {
          if (!foreign) throw new Error('Foreign workspace fixture is missing')
          const foreignReceipt = createFileReadReceipt(
            { entityType: 'workspace', entityId: foreign.workspaceId },
            [file]
          )
          await expect(
            db.transaction((tx) => recheckFileReadReceipt(tx, foreignReceipt))
          ).rejects.toThrow('A file changed')
          return
        } else {
          await db
            .update(workspaceFiles)
            .set(
              mutation === 'revision'
                ? { contentUpdatedAt: new Date(file.contentUpdatedAt.getTime() + 1000) }
                : { key: `${file.key}.changed` }
            )
            .where(eq(workspaceFiles.id, file.id))
        }
        await expect(db.transaction((tx) => recheckFileReadReceipt(tx, receipt))).rejects.toThrow(
          'A file changed'
        )
      })
    }
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

check('same-revision provenance downgrade reaches the content admission gate', async () => {
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
  const observed: ContentProvenance[] = []
  const result = await observeContentDelivery(
    {
      async admit(sources) {
        observed.push(...sources.map((source) => source.provenance))
        return sources.map(() => true)
      },
    },
    () =>
      downloadWorkspaceFileStream.execute({
        principal: createDelegatedPrincipal({
          subjectUserId: f.editorId,
          workspaceId: f.workspaceId,
          audience: 'sim:workspace-files',
        }),
        input: { fileId: file.id },
      })
  )
  await result.stream.cancel()
  const [current] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, file.id))
  expect(current.contentUpdatedAt).toEqual(file.contentUpdatedAt)
  expect(observed.at(-1)).toEqual({ status: 'unknown' })
})

describe('A workflow run Chat started reads workspace files as any run does', () => {
  async function chatStartedRunRead(provenance: 'recorded' | 'unknown') {
    const f = await fixture()
    const uploaded = await uploadWorkspaceFile(
      f.workspaceId,
      f.editorId,
      Buffer.from('run input'),
      'digest.md',
      'text/markdown',
      { notifyWorkspaceChange: false }
    )
    if (provenance === 'unknown') {
      await markWorkspaceFileSecretProvenanceUnknown(f.workspaceId, [uploaded.id])
    }
    const file: UserFile = {
      id: uploaded.id,
      name: uploaded.name,
      url: uploaded.url,
      size: uploaded.size,
      type: uploaded.type,
      key: uploaded.key,
      context: 'workspace',
    }
    const executionId = generateId()
    const hydrate = () =>
      hydrateUserFilesWithBase64([file], {
        principal: createDelegatedPrincipal({
          subjectUserId: f.editorId,
          workspaceId: f.workspaceId,
          audience: 'sim:workflows',
          resourceScope: { chatId: generateId() },
        }),
        workspaceId: f.workspaceId,
        workflowId: generateId(),
        executionId,
        userId: f.editorId,
        requestId: executionId,
      }).then(([hydrated]) => hydrated.base64)
    return { hydrate, expected: Buffer.from('run input').toString('base64') }
  }

  check('a queued run hydrates its file with no Chat gate around it', async () => {
    const { hydrate, expected } = await chatStartedRunRead('recorded')
    await expect(runWorkflowOutsideContentDelivery(hydrate)).resolves.toBe(expected)
  })

  check(
    'an in-process run neither consults nor is refused by the Chat gate around it',
    async () => {
      const { hydrate, expected } = await chatStartedRunRead('unknown')
      const consulted: string[] = []
      const base64 = await observeContentDelivery(
        {
          async admit(sources) {
            consulted.push(...sources.map((item) => item.id))
            return sources.map(() => false)
          },
        },
        () => runWorkflowOutsideContentDelivery(hydrate)
      )
      expect(base64).toBe(expected)
      expect(consulted).toEqual([])
    }
  )

  check('Chat reading outside a run with no gate still gets no bytes', async () => {
    const { hydrate } = await chatStartedRunRead('recorded')
    await expect(hydrate()).resolves.toBeUndefined()
  })
})

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
