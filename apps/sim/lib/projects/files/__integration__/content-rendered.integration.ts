import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ResourceDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  fileSearchDispatchQueue,
  folder,
  idempotencyKey,
  member,
  organization,
  outboxEvent,
  permissions,
  subscription,
  user,
  workspace,
  workspaceFileSearchRevision,
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

import { observeContentDelivery } from '@/lib/core/application/content-delivery'
import * as sandboxTask from '@/lib/execution/sandbox/run-task'
import { readProjectFileArtifact } from '@/lib/projects/files/application/artifacts'
import {
  createProjectFile,
  readProjectFileContent,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import {
  readProjectFileCsvPreview,
  readProjectInlineFile,
} from '@/lib/projects/files/application/previews'
import { searchProjectFileContent } from '@/lib/projects/files/application/search'
import { revertProjectFileVersion } from '@/lib/projects/files/application/versions'
import { lockProjectShared } from '@/lib/projects/membership'
import * as storageCleanup from '@/lib/uploads/contexts/workspace/file-storage-cleanup-outbox'
import * as storage from '@/lib/uploads/core/storage-service'
import { compileFileDocument } from '@/lib/uploads/documents/compile'
import * as heic from '@/lib/uploads/server/heic'
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { FILE_SEARCH_ARTIFACT_READY_LOCK_TIMEOUT_MS } from '@/lib/workspace-files/search/constants'
import * as searchDelivery from '@/lib/workspace-files/search/delivery'
import * as searchRepository from '@/lib/workspace-files/search/repository'

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

/** File creation marks a revision pending, so a requeue check starts from no revision at all. */
async function clearSearchRevision(fileId: string) {
  await db.delete(workspaceFileSearchRevision).where(eq(workspaceFileSearchRevision.fileId, fileId))
}

async function searchRevision(fileId: string) {
  const [revision] = await db
    .select()
    .from(workspaceFileSearchRevision)
    .where(eq(workspaceFileSearchRevision.fileId, fileId))
  return revision
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

describe('Project delivery admission', () => {
  for (const kind of ['inline', 'csv', 'artifact'] as const) {
    for (const refusal of ['before storage', 'after storage'] as const) {
      check(`${kind} gates content ${refusal}`, async () => {
        const f = await fixture()
        const created = await createProjectFile.execute({
          principal: f.principal,
          input: {
            ...createInput(f.projectId, 'name,value\nrow,secret'),
            name: 'rows.csv',
            contentType: 'text/csv',
          },
        })
        const issuedAt = new Date()
        const principal: ResourceDelegatedPrincipal = {
          kind: 'resource_delegated',
          serviceId: 'copilot',
          subjectUserId: f.editorId,
          delegationId: generateId(),
          audience: 'sim:project-files',
          issuedAt,
          expiresAt: new Date(issuedAt.getTime() + 60_000),
          invocation: { kind: 'workspace', workspaceId: f.workspaceId },
          scope: { kind: 'entity', entityType: 'project', entityId: f.projectId },
        }
        const download = vi.spyOn(storage, 'downloadFile')
        const stream = vi.spyOn(storage, 'downloadFileStream')
        let calls = 0
        const input = { projectId: f.projectId, fileId: created.file.id, key: created.file.key }
        await expect(
          observeContentDelivery(
            {
              async admit(sources) {
                calls++
                expect(
                  sources.every((source) => source.view === (kind === 'csv' ? 'excerpt' : 'opaque'))
                ).toBe(true)
                return sources.map(() => refusal === 'after storage' && calls === 1)
              },
            },
            () =>
              kind === 'inline'
                ? readProjectInlineFile.execute({
                    principal,
                    input: { projectId: f.projectId, referenceFileId: created.file.id },
                  })
                : kind === 'csv'
                  ? readProjectFileCsvPreview.execute({ principal, input })
                  : readProjectFileArtifact.execute({
                      principal,
                      input: { ...input, maxBytes: 1024 },
                    })
          )
        ).rejects.toMatchObject({ code: 'forbidden' })
        if (refusal === 'before storage') {
          expect(download).not.toHaveBeenCalled()
          expect(stream).not.toHaveBeenCalled()
        } else expect(calls).toBeGreaterThan(1)
      })
    }
  }
  for (const kind of ['inline', 'csv', 'artifact'] as const) {
    check(`${kind} awaits an asynchronous transport observer refusal`, async () => {
      const f = await fixture()
      const created = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'name,value\nrow,secret'),
          name: 'rows.csv',
          contentType: 'text/csv',
        },
      })
      const error = new Error('Transport observer refused delivery')
      const input = { projectId: f.projectId, fileId: created.file.id, key: created.file.key }
      await expect(
        observeWorkspaceFileDelivery(
          async () => {
            throw error
          },
          () =>
            kind === 'inline'
              ? readProjectInlineFile.execute({
                  principal: f.principal,
                  input: { projectId: f.projectId, referenceFileId: created.file.id },
                })
              : kind === 'csv'
                ? readProjectFileCsvPreview.execute({ principal: f.principal, input })
                : readProjectFileArtifact.execute({
                    principal: f.principal,
                    input: { ...input, maxBytes: 1024 },
                  })
        )
      ).rejects.toBe(error)
    })
  }

  check('Project search withholds stale previews and removes moved-out results', async () => {
    const f = await fixture()
    const created = await createProjectFile.execute({
      principal: f.principal,
      input: createInput(f.projectId),
    })
    const identity = {
      fileId: created.file.id,
      key: created.file.key,
      contentUpdatedAt: new Date(),
    }
    const prepared: searchRepository.FileSearchResult = {
      results: [
        { fileId: created.file.id, text: 'stale secret', lineNumber: 1 },
        { fileId: 'moved', text: 'out of scope', lineNumber: 1 },
      ],
      count: 2,
      truncated: false,
      complete: true,
      indexStatus: {
        readyFiles: 0,
        pendingFiles: 0,
        failedFiles: 0,
        skippedFiles: 0,
        partialFiles: 0,
      },
      sources: [
        {
          owner: { entityType: 'project', entityId: f.projectId },
          identity,
          buildId: 'old-build',
          dependencies: [],
        },
      ],
    }
    vi.spyOn(searchRepository, 'searchFileIndex').mockResolvedValue(prepared)
    vi.spyOn(searchDelivery, 'loadFileSearchDelivery').mockResolvedValue({
      current: new Set(),
      provenance: new Map(),
      outOfScope: new Set(['moved']),
      inputs: [],
    })
    const result = await searchProjectFileContent.execute({
      principal: f.principal,
      input: { projectId: f.projectId, query: 'secret', mode: 'exact', maxResults: 10 },
    })
    expect(result.count).toBe(1)
    expect(result.results[0].text).toContain('Preview withheld')
    expect(result.sources).toEqual([])
    expect(JSON.stringify(result)).not.toContain('stale secret')
  })
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

  check('preserves size rejection and a concurrently published image derivative', async () => {
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
    vi.spyOn(storageCleanup, 'enqueueWorkspaceFileStorageCleanups').mockRejectedValue(
      new Error('Cleanup database unavailable')
    )
    const input = { projectId: f.projectId, fileId: source.file.id, preview: true }
    let winner: Buffer | undefined
    vi.spyOn(heic, 'transcodeHeicToJpeg')
      .mockResolvedValue(Buffer.alloc(128, 255))
      .mockImplementationOnce(async () => {
        winner = (
          await readProjectFileArtifact.execute({
            principal: f.principal,
            input: { ...input, maxBytes: 1024 },
          })
        ).buffer
        return Buffer.alloc(128, 255)
      })
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
    ).toHaveLength(1)
    const subsequent = await readProjectFileArtifact.execute({
      principal: f.principal,
      input: { ...input, maxBytes: 1024 },
    })
    expect(winner).toBeDefined()
    expect(subsequent.buffer).toEqual(winner)
  })
})

describe('Project rendered artifacts against PostgreSQL and private storage', () => {
  for (const failure of ['size rejection', 'revision change'] as const) {
    check(
      `a preview with ${failure} retains the shared derivative and preserves the original error`,
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
          .toHaveLength(1)
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
    check(
      `a render with ${failure} preserves shared published objects without scheduling deletion`,
      async () => {
        const { readProjectFileArtifact } = await import(
          '@/lib/projects/files/application/artifacts'
        )
        const f = await fixture()
        const asset = await createProjectFile.execute({
          principal: f.principal,
          input: {
            ...createInput(f.projectId, 'image'),
            name: 'logo.png',
            contentType: 'image/png',
          },
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
        expect(events).toEqual([])
        for (const key of writtenKeys)
          expect((await readFile(join(localStorageRoot, key))).length).toBeGreaterThan(0)
        expect(await readFile(join(localStorageRoot, source.file.key))).toEqual(
          Buffer.from(`getFileBase64('${asset.file.id}')`)
        )
      }
    )
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
    'a generated artifact read beside a concurrent Project reader completes and requeues search',
    async () => {
      const f = await fixture()
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'const title = "concurrent"'),
          name: 'deck.pptx',
          contentType: 'text/x-pptxgenjs',
        },
      })
      const artifact = Buffer.from('PK\u0003\u0004document')
      vi.spyOn(sandboxTask, 'runSandboxTask').mockResolvedValue(artifact)
      let markHeld = () => {}
      const held = new Promise<void>((resolve) => {
        markHeld = resolve
      })
      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const concurrentReader = db.transaction(async (tx) => {
        await lockProjectShared(tx, f.projectId)
        markHeld()
        await released
      })
      await held
      await clearSearchRevision(source.file.id)
      try {
        const rendered = await observeWorkspaceFileDelivery(
          async () => release(),
          () =>
            readProjectFileArtifact.execute({
              principal: f.principal,
              input: { projectId: f.projectId, fileId: source.file.id, maxBytes: 1_000_000 },
            })
        )
        expect(rendered.buffer).toEqual(artifact)
      } finally {
        release()
        await concurrentReader
      }
      const revision = await searchRevision(source.file.id)
      expect(revision?.status).toBe('pending')
      expect(revision?.sourceContentUpdatedAt).toEqual(source.file.contentUpdatedAt)
    }
  )

  check(
    'a contended search requeue gives up within its short bound without failing the read',
    async () => {
      const f = await fixture()
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'const title = "contended"'),
          name: 'deck.pptx',
          contentType: 'text/x-pptxgenjs',
        },
      })
      const artifact = Buffer.from('PK\u0003\u0004document')
      vi.spyOn(sandboxTask, 'runSandboxTask').mockResolvedValue(artifact)
      let markHeld = () => {}
      const held = new Promise<void>((resolve) => {
        markHeld = resolve
      })
      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const concurrentReader = db.transaction(async (tx) => {
        await lockProjectShared(tx, f.projectId)
        markHeld()
        await released
      })
      await held
      await clearSearchRevision(source.file.id)
      try {
        const started = performance.now()
        const rendered = await readProjectFileArtifact.execute({
          principal: f.principal,
          input: { projectId: f.projectId, fileId: source.file.id, maxBytes: 1_000_000 },
        })
        expect(rendered.buffer).toEqual(artifact)
        expect(performance.now() - started).toBeLessThan(
          FILE_SEARCH_ARTIFACT_READY_LOCK_TIMEOUT_MS + 2_000
        )
      } finally {
        release()
        await concurrentReader
      }
      expect(await searchRevision(source.file.id)).toBeUndefined()
    }
  )

  check("a Project page embedding another owner's image is a missing input", async () => {
    const f = await fixture()
    for (const owner of [`workspace=${f.workspaceId}`, `project=${generateId()}`]) {
      const page = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(
            f.projectId,
            `---\ntitle: Design\n---\n\n![Diagram](sim:file/${generateId()}?${owner})`
          ),
          name: `${generateId()}.html`,
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
  })

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

  check('a source renamed during rendering is refused', async () => {
    const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
    const { renameProjectFile } = await import('@/lib/projects/files/application/lifecycle')
    const f = await fixture()
    const source = await createProjectFile.execute({
      principal: f.principal,
      input: {
        ...createInput(f.projectId, 'const title = "test"'),
        name: 'before.pptx',
        contentType: 'text/x-pptxgenjs',
      },
    })
    vi.spyOn(sandboxTask, 'runSandboxTask').mockImplementation(async () => {
      await renameProjectFile.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, name: 'after.docx' },
      })
      return Buffer.from('PK\u0003\u0004document')
    })
    await expect(
      readProjectFileArtifact.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, maxBytes: 1_000_000 },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

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
        vi.spyOn(sandboxTask, 'runSandboxTask').mockResolvedValue(artifact)
        await compileFileDocument({
          owner: { entityType: 'project', entityId: f.projectId },
          source,
          sourceMime: 'text/x-pptxgenjs',
          fileName: 'architecture.pptx',
          inputs: [],
          maxBytes: 1_000_000,
        })
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
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const f of fixtures) {
    await db.delete(idempotencyKey).where(sql`${idempotencyKey.key} LIKE ${`%${f.projectId}%`}`)
    await db
      .delete(outboxEvent)
      .where(
        sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/%`} OR ${outboxEvent.payload}::jsonb -> 'owner' ->> 'entityId' = ${f.projectId}`
      )
    await db
      .delete(fileSearchDispatchQueue)
      .where(eq(fileSearchDispatchQueue.entityId, f.projectId))
    await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
    await db.delete(folder).where(eq(folder.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(subscription).where(eq(subscription.referenceId, f.organizationId))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, [f.ownerId, f.editorId]))
  }
  await rm(localStorageRoot, { recursive: true, force: true })
  const report =
    process.env.PROJECT_FILE_RENDERED_CONTENT_REPORT_PATH ??
    'test-results/project-file-rendered-content.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
  await db.$client.end()
})
