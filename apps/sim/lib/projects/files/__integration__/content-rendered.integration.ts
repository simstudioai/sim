import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  folder,
  idempotencyKey,
  member,
  organization,
  outboxEvent,
  permissions,
  subscription,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

import { processOutboxEventById } from '@/lib/core/outbox/service'
import * as sandboxTask from '@/lib/execution/sandbox/run-task'
import { readProjectFileArtifact } from '@/lib/projects/files/application/artifacts'
import {
  createProjectFile,
  readProjectFileContent,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import { searchProjectFileContent } from '@/lib/projects/files/application/search'
import { revertProjectFileVersion } from '@/lib/projects/files/application/versions'
import * as storageCleanup from '@/lib/uploads/contexts/workspace/file-storage-cleanup-outbox'
import { workspaceFileStorageCleanupOutboxHandlers } from '@/lib/uploads/contexts/workspace/file-storage-cleanup-outbox'
import * as storage from '@/lib/uploads/core/storage-service'
import { storeCompiledDoc } from '@/lib/uploads/documents/compiled-store'
import * as heic from '@/lib/uploads/server/heic'
import * as searchDelivery from '@/lib/workspace-files/search/delivery'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const localStorageRoot = mkdtempSync(join(tmpdir(), 'sim-project-content-'))
setUploadDirServer(localStorageRoot)
const fixtures: {
  ownerId: string
  editorId: string
  organizationId: string
  workspaceId: string
  projectId: string
}[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

beforeEach(() => {
  vi.restoreAllMocks()
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  vi.stubEnv('FREE_STORAGE_LIMIT_GB', '')
})

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
  const organizationId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values(
    [ownerId, editorId].map((id) => ({
      id,
      email: `${id}@content.invalid`,
      name: 'File content fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Content', slug: organizationId, createdAt: new Date() })
  await db.insert(member).values(
    [ownerId, editorId].map((userId) => ({
      id: generateId(),
      organizationId,
      userId,
      role: userId === ownerId ? 'owner' : 'member',
      createdAt: new Date(),
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
    workspaceMode: 'organization',
    name: 'Content environment',
  })
  const [binding] = await db.select().from(workspace).where(eq(workspace.id, workspaceId))
  if (!binding) throw new Error('Project fixture missing')
  await db.insert(permissions).values({
    id: generateId(),
    userId: editorId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const ids = { ownerId, editorId, organizationId, workspaceId, projectId: binding.projectId }
  fixtures.push(ids)
  return { ...ids, principal: createSessionPrincipal({ userId: editorId }) }
}

function createInput(projectId: string, content = 'Project architecture') {
  return {
    projectId,
    name: 'architecture.md',
    contentType: 'text/markdown',
    content,
    encoding: 'utf-8' as const,
    exactName: true,
  }
}

describe('Project file content against PostgreSQL and the local object store', () => {
  for (const code of ['55P03', '25P04']) {
    check(`Project search classifies delivery contention ${code} as retryable`, async () => {
      const f = await fixture()
      const delivery = vi
        .spyOn(searchDelivery, 'loadFileSearchDelivery')
        .mockRejectedValueOnce(
          new Error('Failed query', { cause: Object.assign(new Error('lock timeout'), { code }) })
        )
      try {
        await expect(
          searchProjectFileContent.execute({
            principal: f.principal,
            input: { projectId: f.projectId, query: 'needle', mode: 'exact', maxResults: 10 },
          })
        ).rejects.toMatchObject({ code: 'locked' })
      } finally {
        delivery.mockRestore()
      }
    })
  }
})

describe('Project outer transaction cleanup', () => {
  for (const { operation, code } of [
    { operation: 'create', code: undefined },
    { operation: 'update', code: undefined },
    { operation: 'revert', code: undefined },
    { operation: 'preview', code: undefined },
    { operation: 'update', code: '40003' },
    { operation: 'update', code: 'CONNECTION_CLOSED' },
  ] as const) {
    check(
      `retains committed Project ${operation} bytes after acknowledgement loss (${code ?? 'uncoded'})`,
      async () => {
        const f = await fixture()
        const sourceBytes = Buffer.alloc(16)
        sourceBytes.writeUInt32BE(16, 0)
        sourceBytes.write('ftypheic', 4, 'ascii')
        const source = await createProjectFile.execute({
          principal: f.principal,
          input:
            operation === 'preview'
              ? {
                  ...createInput(f.projectId),
                  name: 'preview.heic',
                  contentType: 'image/heic',
                  content: sourceBytes.toString('base64'),
                  encoding: 'base64',
                }
              : createInput(f.projectId, 'original'),
        })
        if (operation === 'revert')
          await updateProjectFileContent.execute({
            principal: f.principal,
            input: {
              projectId: f.projectId,
              fileId: source.file.id,
              content: 'second',
              encoding: 'utf-8',
            },
          })
        vi.spyOn(heic, 'transcodeHeicToJpeg').mockResolvedValue(Buffer.alloc(128, 255))
        const upload = storage.uploadFile
        const written: string[] = []
        vi.spyOn(storage, 'uploadFile').mockImplementation(async (args) => {
          const result = await upload(args)
          written.push(result.key)
          return result
        })
        const transaction = db.transaction.bind(db)
        const primary = Object.assign(
          new Error('Commit acknowledgement lost'),
          code ? { code } : {}
        )
        let lost = false
        vi.spyOn(db, 'transaction').mockImplementation(async (callback, config) => {
          const result = await transaction(callback, config)
          if (
            !lost &&
            written.length > 0 &&
            isRecordLike(result) &&
            isRecordLike(result.result) &&
            'file' in result.result
          ) {
            lost = true
            throw primary
          }
          return result
        })
        const input = { projectId: f.projectId, fileId: source.file.id }
        const action =
          operation === 'create'
            ? createProjectFile.execute({
                principal: f.principal,
                input: { ...createInput(f.projectId, 'committed'), name: 'new.md' },
              })
            : operation === 'update'
              ? updateProjectFileContent.execute({
                  principal: f.principal,
                  input: { ...input, content: 'committed', encoding: 'utf-8' },
                })
              : operation === 'revert'
                ? revertProjectFileVersion.execute({
                    principal: f.principal,
                    input: { ...input, version: 1, expectedCurrentVersion: 2 },
                  })
                : readProjectFileArtifact.execute({
                    principal: f.principal,
                    input: { ...input, preview: true, maxBytes: 1024 },
                  })
        await expect(action).rejects.toBe(primary)
        expect(lost).toBe(true)
        expect(written).toHaveLength(1)
        for (const key of written) {
          expect((await readFile(join(localStorageRoot, key))).length).toBeGreaterThan(0)
          expect(
            await db
              .select()
              .from(outboxEvent)
              .where(sql`${outboxEvent.payload}::jsonb ->> 'key' = ${key}`)
          ).toEqual([])
        }
      }
    )
  }

  check(
    'preserves preview size rejection when cleanup enqueue fails and deletes the derivative',
    async () => {
      const f = await fixture()
      const bytes = Buffer.alloc(16)
      bytes.writeUInt32BE(16, 0)
      bytes.write('ftypheic', 4, 'ascii')
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId),
          name: 'preview.heic',
          contentType: 'image/heic',
          content: bytes.toString('base64'),
          encoding: 'base64',
        },
      })
      vi.spyOn(heic, 'transcodeHeicToJpeg').mockResolvedValue(Buffer.alloc(128, 255))
      vi.spyOn(storageCleanup, 'enqueueWorkspaceFileStorageCleanups').mockRejectedValue(
        new Error('Cleanup database unavailable')
      )
      await expect
        .soft(
          readProjectFileArtifact.execute({
            principal: f.principal,
            input: { projectId: f.projectId, fileId: source.file.id, preview: true, maxBytes: 64 },
          })
        )
        .rejects.toMatchObject({ name: 'PayloadSizeLimitError' })
      expect(
        await readdir(join(localStorageRoot, 'project', f.projectId, 'image-derivative'))
      ).toEqual([])
    }
  )
})

describe('Project rendered artifacts against PostgreSQL and private storage', () => {
  for (const failure of ['size rejection', 'revision change'] as const) {
    check(
      `a preview with ${failure} removes its derivative and preserves the original error`,
      async () => {
        const f = await fixture()
        const sourceBytes = Buffer.alloc(16)
        sourceBytes.writeUInt32BE(16, 0)
        sourceBytes.write('ftypheic', 4, 'ascii')
        const source = await createProjectFile.execute({
          principal: f.principal,
          input: {
            ...createInput(f.projectId),
            name: 'preview.heic',
            contentType: 'image/heic',
            content: sourceBytes.toString('base64'),
            encoding: 'base64',
          },
        })
        vi.spyOn(heic, 'transcodeHeicToJpeg').mockImplementation(async () => {
          if (failure === 'revision change') {
            await updateProjectFileContent.execute({
              principal: f.principal,
              input: {
                projectId: f.projectId,
                fileId: source.file.id,
                content: 'replacement source',
                encoding: 'utf-8',
              },
            })
          }
          return Buffer.alloc(128, 255)
        })
        const rendering = readProjectFileArtifact.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: source.file.id,
            preview: true,
            maxBytes: failure === 'size rejection' ? 64 : 1024,
          },
        })
        await expect
          .soft(rendering)
          .rejects.toMatchObject(
            failure === 'size rejection' ? { name: 'PayloadSizeLimitError' } : { code: 'conflict' }
          )
        expect
          .soft(await readdir(join(localStorageRoot, 'project', f.projectId, 'image-derivative')))
          .toEqual([])
        const current = await readProjectFileContent.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: source.file.id },
        })
        expect(current.content).toEqual(
          failure === 'size rejection' ? sourceBytes : Buffer.from('replacement source')
        )
      }
    )
  }

  for (const failure of ['revoked read', 'uncertain pointer upload'] as const) {
    check(`a render with ${failure} durably removes its newly published objects`, async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'image'), name: 'logo.png', contentType: 'image/png' },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, `getFileBase64('${asset.file.id}')`),
          name: 'design.pptx',
          contentType: 'text/x-pptxgenjs',
        },
      })
      vi.spyOn(sandboxTask, 'runSandboxTask').mockResolvedValue(
        Buffer.from('PK\u0003\u0004document')
      )
      const upload = storage.uploadFile
      const writtenKeys: string[] = []
      vi.spyOn(storage, 'uploadFile').mockImplementation(async (options) => {
        const result = await upload(options)
        if (result.key.startsWith(`project/${f.projectId}/compiled/`)) {
          writtenKeys.push(result.key)
          if (result.key.endsWith('.published.json')) {
            if (failure === 'uncertain pointer upload') throw new Error('Lost upload response')
            await db.delete(permissions).where(eq(permissions.userId, f.editorId))
          }
        }
        return result
      })
      vi.spyOn(storage, 'deleteFile').mockRejectedValue(new Error('Cleanup unavailable'))
      const rendering = readProjectFileArtifact.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, maxBytes: 1_000_000 },
      })
      if (failure === 'revoked read') {
        await expect(rendering).rejects.toMatchObject({ code: 'not_found' })
      } else {
        await expect(rendering).rejects.toThrow('Lost upload response')
      }
      expect(writtenKeys).toHaveLength(2)
      const events = await db
        .select()
        .from(outboxEvent)
        .where(
          sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/compiled/%`}`
        )
      expect(events).toHaveLength(2)
      expect(events.map((event) => event.status)).toEqual(['pending', 'pending'])
      vi.mocked(storage.deleteFile).mockRestore()
      for (const event of events) {
        await db
          .update(outboxEvent)
          .set({ availableAt: new Date(0) })
          .where(eq(outboxEvent.id, event.id))
        await processOutboxEventById(event.id, workspaceFileStorageCleanupOutboxHandlers)
      }
      expect(await readdir(join(localStorageRoot, 'project', f.projectId, 'compiled'))).toEqual([])
      expect(await readFile(join(localStorageRoot, source.file.key))).toEqual(
        Buffer.from(`getFileBase64('${asset.file.id}')`)
      )
    })
  }

  check(
    'artifact pages bind embedded asset provenance and separately gate opaque model delivery',
    async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const secret = {
        status: 'exact' as const,
        entries: [
          {
            encryptedValue: 'fixture-ciphertext',
            sourceUserId: f.editorId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'private image bytes'),
          name: 'diagram.png',
          contentType: 'image/png',
          secretProvenance: secret,
        },
      })
      const source = `---\ntitle: Design\n---\n\n![Diagram](sim:file/${asset.file.id})`
      const page = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, source),
          name: 'design.html',
          contentType: 'text/x-sim-page',
        },
      })
      const input = { projectId: f.projectId, fileId: page.file.id, maxBytes: 1_000_000 }
      const rendered = await readProjectFileArtifact.execute({ principal: f.principal, input })
      expect(rendered.contentType).toBe('text/html')
      expect(rendered.buffer.toString()).toContain(
        `data:image/png;base64,${Buffer.from('private image bytes').toString('base64')}`
      )
      expect(rendered.secretProvenance).toEqual(secret)
      await expect(
        readProjectFileArtifact.execute({
          principal: f.principal,
          input: { ...input, forModel: true },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: asset.file.id,
          content: 'public image bytes',
          encoding: 'utf-8',
          expectedUpdatedAt: asset.file.contentUpdatedAt,
        },
      })
      const clean = await readProjectFileArtifact.execute({
        principal: f.principal,
        input: { ...input, forModel: true },
      })
      expect(clean.secretProvenance).toEqual({ status: 'exact', entries: [] })
      expect(clean.buffer.toString()).toContain(
        Buffer.from('public image bytes').toString('base64')
      )
    }
  )

  check(
    'artifact source cannot import a foreign Project asset through a valid source-file capability',
    async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const foreign = await fixture()
      const asset = await createProjectFile.execute({
        principal: foreign.principal,
        input: {
          ...createInput(foreign.projectId, 'foreign bytes'),
          name: 'private.png',
          contentType: 'image/png',
        },
      })
      const page = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(
            f.projectId,
            `---\ntitle: Design\n---\n\n![Diagram](sim:file/${asset.file.id})`
          ),
          name: 'design.html',
          contentType: 'text/x-sim-page',
        },
      })
      await expect(
        readProjectFileArtifact.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: page.file.id, maxBytes: 1_000_000 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check(
    'an asset changed during render cannot be delivered with stale provenance or source identity',
    async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const f = await fixture()
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'before'),
          name: 'diagram.png',
          contentType: 'image/png',
        },
      })
      const page = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(
            f.projectId,
            `---\ntitle: Design\n---\n\n![Diagram](sim:file/${asset.file.id})`
          ),
          name: 'design.html',
          contentType: 'text/x-sim-page',
        },
      })
      const download = storage.downloadFile
      let changed = false
      vi.spyOn(storage, 'downloadFile').mockImplementation(async (options) => {
        const bytes = await download(options)
        if (!changed && options.key === asset.file.key) {
          changed = true
          await updateProjectFileContent.execute({
            principal: f.principal,
            input: {
              projectId: f.projectId,
              fileId: asset.file.id,
              content: 'after',
              encoding: 'utf-8',
              expectedUpdatedAt: asset.file.contentUpdatedAt,
              secretProvenance: { status: 'unknown' },
            },
          })
        }
        return bytes
      })
      await expect(
        readProjectFileArtifact.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: page.file.id, maxBytes: 1_000_000 },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
    }
  )

  check(
    'generated Office artifacts use the canonical owner cache without exposing generator source',
    async () => {
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const a = await fixture()
      const b = await fixture()
      const source = 'const title = "architecture"'
      const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      const prepared = []
      for (const [f, marker] of [
        [a, 'project A'],
        [b, 'project B'],
      ] as const) {
        const created = await createProjectFile.execute({
          principal: f.principal,
          input: {
            ...createInput(f.projectId, source),
            name: 'architecture.pptx',
            contentType: 'text/x-pptxgenjs',
          },
        })
        const artifact = Buffer.from(`PK\u0003\u0004${marker}`)
        await storeCompiledDoc(
          { entityType: 'project', entityId: f.projectId },
          source,
          'pptx',
          mime,
          artifact
        )
        prepared.push({ f, created, artifact })
      }
      for (const { f, created, artifact } of prepared) {
        const rendered = await readProjectFileArtifact.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: created.file.id,
            maxBytes: 1_000_000,
            forModel: true,
          },
        })
        expect(rendered.buffer).toEqual(artifact)
        expect(rendered.contentType).toBe(mime)
        expect(rendered.secretProvenance).toEqual({ status: 'exact', entries: [] })
      }
    }
  )
})

afterAll(async () => {
  vi.restoreAllMocks()
  for (const f of fixtures) {
    await db.delete(idempotencyKey).where(sql`${idempotencyKey.key} LIKE ${`%${f.projectId}%`}`)
    await db
      .delete(outboxEvent)
      .where(
        sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/%`} OR ${outboxEvent.payload}::jsonb -> 'owner' ->> 'entityId' = ${f.projectId}`
      )
    await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
    await db.delete(folder).where(eq(folder.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(subscription).where(eq(subscription.referenceId, f.organizationId))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, [f.ownerId, f.editorId]))
  }
  await rm(localStorageRoot, { recursive: true, force: true })
  const report =
    process.env.PROJECT_FILE_CONTENT_REPORT_PATH ?? 'test-results/project-file-content.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
  await db.$client.end()
})
