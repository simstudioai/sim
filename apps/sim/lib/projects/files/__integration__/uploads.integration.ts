import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ResourceDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  folder,
  member,
  organization,
  outboxEvent,
  permissions,
  projectWorkspace,
  uploadSession,
  user,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const redisUrl = readTestRedisUrl()
  if (redisUrl) process.env.REDIS_URL = redisUrl
  return { redisUrl }
})

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import * as application from '@/lib/projects/files/application'
import * as prefixCleanup from '@/lib/projects/files/prefix-cleanup'
import * as manager from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  UPLOAD_URL_TTL_MS,
  writeLocalMultipartPart,
  writeLocalPutObject,
} from '@/lib/uploads/upload-session/provider'
import * as sessions from '@/lib/uploads/upload-session/service'
import { simPageSourceEmbedBlock } from '@/lib/workspace-files/page-source-embed'

const redisKeys: string[] = []
const storageRoot = mkdtempSync(join(tmpdir(), 'sim-project-upload-'))
setUploadDirServer(storageRoot)
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
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  vi.stubEnv('PROJECT_FILES_ENABLED', 'true')
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
      email: `${id}@upload.invalid`,
      name: 'Upload fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Upload', slug: organizationId, createdAt: new Date() })
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
    name: 'Upload environment',
  })
  const [binding] = await db
    .select()
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, workspaceId))
  if (!binding) throw new Error('Project fixture missing')
  await db.insert(permissions).values({
    id: generateId(),
    userId: editorId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const f = { ownerId, editorId, organizationId, workspaceId, projectId: binding.projectId }
  fixtures.push(f)
  return { ...f, principal: createSessionPrincipal({ userId: editorId, sessionId: generateId() }) }
}

function stream(bytes: Buffer) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}
function input(projectId: string, fileSize = 4) {
  return {
    projectId,
    fileName: 'architecture.bin',
    contentType: 'application/octet-stream',
    fileSize,
    localOrigin: 'http://localhost:3000',
  }
}
function control(projectId: string, session: sessions.UploadSessionRecord) {
  return { projectId, uploadId: session.id, uploadToken: session.uploadToken }
}
async function put(session: sessions.UploadSessionRecord, bytes: Buffer) {
  await writeLocalPutObject({
    uploadId: session.id,
    key: session.finalKey,
    body: stream(bytes),
    expectedSize: bytes.length,
    contentType: session.contentType,
    metadata: sessions.uploadSessionObjectMetadata(session),
  })
}
async function usage(id: string) {
  const [row] = await db
    .select({ bytes: organization.storageUsedBytes })
    .from(organization)
    .where(eq(organization.id, id))
  return row.bytes
}

describe('Project outer transaction cleanup for upload sessions', () => {
  check('preserves upload authorization failure when its cleanup hook fails', async () => {
    const f = await fixture()
    const create = sessions.createUploadSession
    const preparation = vi
      .spyOn(sessions, 'createUploadSession')
      .mockImplementation(async (args) => {
        const session = await create(args)
        await db.delete(permissions).where(eq(permissions.userId, f.editorId))
        return session
      })
    const cleanup = vi
      .spyOn(prefixCleanup, 'queueRetiredProjectUploadCleanup')
      .mockRejectedValue(new Error('Cleanup database unavailable'))
    try {
      await expect(
        application.createProjectFileUploadSession.execute({
          principal: f.principal,
          input: input(f.projectId),
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    } finally {
      preparation.mockRestore()
      cleanup.mockRestore()
    }
  })
  check('retains the created upload session after acknowledgement loss', async () => {
    const f = await fixture()
    const transaction = db.transaction.bind(db)
    let sessionId = ''
    let originalStatus: unknown
    const primary = new Error('Commit acknowledgement lost')
    const interception = vi
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback, config) => {
        const result = await transaction(callback, config)
        if (
          isRecordLike(result) &&
          isRecordLike(result.result) &&
          result.result.purpose === 'project_file'
        ) {
          sessionId = String(result.result.id)
          originalStatus = result.result.status
          throw primary
        }
        return result
      })
    try {
      await expect(
        application.createProjectFileUploadSession.execute({
          principal: f.principal,
          input: input(f.projectId),
        })
      ).rejects.toBe(primary)
    } finally {
      interception.mockRestore()
    }
    expect(sessionId).not.toBe('')
    const [row] = await db.select().from(uploadSession).where(eq(uploadSession.id, sessionId))
    expect(row.status).toBe(originalStatus)
  })
  check('retains committed restored upload source after acknowledgement loss', async () => {
    const f = await fixture()
    const source = '---\ntitle: Architecture\n---\n# Notes\nShared Project description'
    const bytes = Buffer.from(
      `<html><head>${simPageSourceEmbedBlock(source)}</head><body>Compiled page</body></html>`
    )
    const session = await application.createProjectFileUploadSession.execute({
      principal: f.principal,
      input: {
        ...input(f.projectId, bytes.length),
        fileName: 'Architecture.html',
        contentType: 'text/html',
      },
    })
    await put(session, bytes)
    const transaction = db.transaction.bind(db)
    const primary = new Error('Commit acknowledgement lost')
    let key = ''
    const interception = vi
      .spyOn(db, 'transaction')
      .mockImplementation(async (callback, config) => {
        const result = await transaction(callback, config)
        if (
          !key &&
          isRecordLike(result) &&
          isRecordLike(result.result) &&
          isRecordLike(result.result.file)
        ) {
          key = String(result.result.file.key)
          throw primary
        }
        return result
      })
    try {
      await expect(
        application.completeProjectFileUploadSession.execute({
          principal: f.principal,
          input: control(f.projectId, session),
        })
      ).rejects.toBe(primary)
    } finally {
      interception.mockRestore()
    }
    expect(key).not.toBe('')
    expect(await readFile(join(storageRoot, key), 'utf8')).toBe(source)
    expect(
      await db.select().from(outboxEvent).where(sql`${outboxEvent.payload}->>'key' = ${key}`)
    ).toEqual([])
  })
})

describe('Project upload sessions with real leases, storage, and accounting', () => {
  check(
    'PUT completion creates one Project file attributed to the actor and replay never bills twice',
    async () => {
      const f = await fixture()
      const directory = await application.createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Design' },
      })
      const session = await application.createProjectFileUploadSession.execute({
        principal: f.principal,
        input: { ...input(f.projectId), folderId: directory.folder.id },
      })
      expect(session).toMatchObject({
        workspaceId: null,
        purpose: 'project_file',
        storageContext: 'project',
        userId: f.editorId,
      })
      await put(session, Buffer.from([0, 255, 17, 1]))
      const result = await application.completeProjectFileUploadSession.execute({
        principal: f.principal,
        input: control(f.projectId, session),
      })
      expect(result.value.file).toMatchObject({
        owner: { entityType: 'project', entityId: f.projectId },
        uploadedBy: f.editorId,
        folderPath: 'Design',
        size: 4,
      })
      expect(await readFile(join(storageRoot, result.value.file.key))).toEqual(
        Buffer.from([0, 255, 17, 1])
      )
      const replay = await application.completeProjectFileUploadSession.execute({
        principal: f.principal,
        input: control(f.projectId, session),
      })
      expect(replay.value.file.id).toBe(result.value.file.id)
      expect(replay.alreadyCompleted).toBe(true)
      expect(await usage(f.organizationId)).toBe(4)
      const polled = await application.getProjectFileUploadSession.execute({
        principal: f.principal,
        input: control(f.projectId, session),
      })
      expect(polled.file?.id).toBe(result.value.file.id)
      await expect(
        application.abortProjectFileUploadSession.execute({
          principal: f.principal,
          input: control(f.projectId, session),
        })
      ).rejects.toMatchObject({ code: 'conflict' })
    }
  )

  check(
    'multipart completion assembles real parts and refuses another credential or revoked caller on every control leg',
    async () => {
      const f = await fixture()
      const size = sessions.UPLOAD_SESSION_PART_SIZE + 1
      const session = await application.createProjectFileUploadSession.execute({
        principal: f.principal,
        input: input(f.projectId, size),
      })
      const target = {
        ...control(f.projectId, session),
        localOrigin: 'http://localhost:3000',
        partNumbers: [1, 2],
      }
      const wrong = { ...f.principal, sessionId: generateId() }
      for (const operation of [
        application.getProjectFileUploadSession,
        application.getProjectFileUploadPartUrls,
        application.completeProjectFileUploadSession,
        application.abortProjectFileUploadSession,
      ]) {
        await expect(operation.execute({ principal: wrong, input: target })).rejects.toMatchObject({
          code: 'not_found',
        })
      }
      await db
        .update(permissions)
        .set({ permissionType: 'read' })
        .where(and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId)))
      for (const operation of [
        application.getProjectFileUploadSession,
        application.getProjectFileUploadPartUrls,
        application.completeProjectFileUploadSession,
        application.abortProjectFileUploadSession,
      ]) {
        await expect(
          operation.execute({ principal: f.principal, input: target })
        ).rejects.toMatchObject({ code: 'forbidden' })
      }
      await db
        .update(permissions)
        .set({ permissionType: 'admin' })
        .where(and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId)))
      expect(
        (
          await application.getProjectFileUploadPartUrls.execute({
            principal: f.principal,
            input: target,
          })
        ).parts
      ).toHaveLength(2)
      await writeLocalMultipartPart({
        uploadId: session.id,
        partNumber: 1,
        body: stream(Buffer.alloc(sessions.UPLOAD_SESSION_PART_SIZE, 7)),
        expectedSize: sessions.UPLOAD_SESSION_PART_SIZE,
      })
      await writeLocalMultipartPart({
        uploadId: session.id,
        partNumber: 2,
        body: stream(Buffer.from([9])),
        expectedSize: 1,
      })
      const result = await application.completeProjectFileUploadSession.execute({
        principal: f.principal,
        input: target,
      })
      const content = await readFile(join(storageRoot, result.value.file.key))
      expect(content.length).toBe(size)
      expect(content[0]).toBe(7)
      expect(content[size - 1]).toBe(9)
      expect(await usage(f.organizationId)).toBe(size)
    }
  )

  check(
    'completion enforces current quota atomically and failed registration remains retryable without deleting bytes',
    async () => {
      const f = await fixture()
      vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
      const session = await application.createProjectFileUploadSession.execute({
        principal: f.principal,
        input: input(f.projectId),
      })
      await put(session, Buffer.from('file'))
      await db
        .update(organization)
        .set({ storageUsedBytes: 1024 ** 3 })
        .where(eq(organization.id, f.organizationId))
      await expect(
        application.completeProjectFileUploadSession.execute({
          principal: f.principal,
          input: control(f.projectId, session),
        })
      ).rejects.toMatchObject({ code: 'payload_too_large' })
      expect(await readFile(join(storageRoot, session.finalKey), 'utf8')).toBe('file')
      expect(
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
      ).toHaveLength(0)
      await db
        .update(organization)
        .set({ storageUsedBytes: 0 })
        .where(eq(organization.id, f.organizationId))
      const result = await application.completeProjectFileUploadSession.execute({
        principal: f.principal,
        input: control(f.projectId, session),
      })
      expect(result.value.file.size).toBe(4)
      expect(await usage(f.organizationId)).toBe(4)
    }
  )

  check(
    'Copilot retries bind the current invocation and preserve unknown provenance when no trusted source was supplied',
    async () => {
      const f = await fixture()
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
      const session = await application.createProjectFileUploadSession.execute({
        principal,
        input: input(f.projectId),
      })
      await put(session, Buffer.from('file'))
      const retryIssuedAt = new Date()
      const fresh = {
        ...principal,
        delegationId: generateId(),
        issuedAt: retryIssuedAt,
        expiresAt: new Date(retryIssuedAt.getTime() + 60_000),
      }
      const result = await application.completeProjectFileUploadSession.execute({
        principal: fresh,
        input: control(f.projectId, session),
      })
      const [provenance] = await db
        .select()
        .from(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, result.value.file.id))
      expect(provenance.status).toBe('unknown')
      expect(provenance.entries).toEqual([])
      expect(result.value.file.uploadedBy).toBe(f.editorId)
    }
  )

  check(
    'an expired completion proof cannot register after another real completion claimed its lease',
    async () => {
      const f = await fixture()
      const session = await application.createProjectFileUploadSession.execute({
        principal: f.principal,
        input: input(f.projectId),
      })
      await put(session, Buffer.from('file'))
      await expect(
        sessions.completeUploadSession({
          session,
          finalize: async (first) => {
            const staged = manager.adoptVerifiedUploadSession(first, {
              entityType: 'project',
              entityId: f.projectId,
            })
            await expect(manager.discardStagedFileContent(staged)).rejects.toThrow('upload session')
            await db
              .update(uploadSession)
              .set({ processingLeaseExpiresAt: new Date(Date.now() - 1000) })
              .where(eq(uploadSession.id, first.id))
            const entered = createDeferred<void>()
            const release = createDeferred<void>()
            const second = sessions.completeUploadSession({
              session: first,
              finalize: async () => {
                entered.resolve()
                await release.promise
                throw new Error('Second lease owns completion')
              },
            })
            await entered.promise
            try {
              await expect(
                db.transaction((tx) => sessions.lockUploadSessionRegistrationInTx(tx, first))
              ).rejects.toMatchObject({ code: 'conflict' })
            } finally {
              release.resolve()
              await expect(second).rejects.toThrow('Second lease owns completion')
            }
            throw new Error('First completion stopped after registration admission check')
          },
        })
      ).rejects.toThrow('First completion stopped after registration admission check')
      expect(await readFile(join(storageRoot, session.finalKey), 'utf8')).toBe('file')
      expect(await usage(f.organizationId)).toBe(0)
      const result = await application.completeProjectFileUploadSession.execute({
        principal: f.principal,
        input: control(f.projectId, session),
      })
      expect(result.value.file.size).toBe(4)
    }
  )

  check('part URLs signed during a concurrent access revocation are not exposed', async () => {
    const f = await fixture()
    const session = await application.createProjectFileUploadSession.execute({
      principal: f.principal,
      input: input(f.projectId, 8 * 1024 * 1024 + 1),
    })
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    const createRealUrls = sessions.createUploadPartUrls
    const signing = vi.spyOn(sessions, 'createUploadPartUrls').mockImplementation(async (args) => {
      const result = await createRealUrls(args)
      entered.resolve()
      await release.promise
      return result
    })
    const pending = application.getProjectFileUploadPartUrls.execute({
      principal: f.principal,
      input: {
        ...control(f.projectId, session),
        partNumbers: [1],
        localOrigin: 'http://localhost:3000',
      },
    })
    await entered.promise
    try {
      await db
        .update(permissions)
        .set({ permissionType: 'read' })
        .where(and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId)))
      release.resolve()
      await expect(pending).rejects.toMatchObject({ code: 'forbidden' })
    } finally {
      release.resolve()
      await pending.catch(() => undefined)
      signing.mockRestore()
    }
  })

  check(
    'compiled page uploads restore editable source without breaking receipt replay or charging compiled bytes',
    async () => {
      const f = await fixture()
      const source = '---\ntitle: Architecture\n---\n# Notes\nShared Project description'
      const bytes = Buffer.from(
        `<html><head>${simPageSourceEmbedBlock(source)}</head><body>Compiled page</body></html>`
      )
      const session = await application.createProjectFileUploadSession.execute({
        principal: f.principal,
        input: {
          ...input(f.projectId, bytes.length),
          fileName: 'Architecture.html',
          contentType: 'text/html',
        },
      })
      await put(session, bytes)
      const completionStartedAt = Date.now()
      const result = await application.completeProjectFileUploadSession.execute({
        principal: f.principal,
        input: control(f.projectId, session),
      })
      expect(result.value.file).toMatchObject({
        name: 'Architecture',
        type: 'text/x-sim-page',
        size: Buffer.byteLength(source),
      })
      expect(await readFile(join(storageRoot, result.value.file.key), 'utf8')).toBe(source)
      const [originalCleanup] = await db
        .select()
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}->>'key' = ${session.finalKey}`)
      expect(originalCleanup.availableAt.getTime()).toBeGreaterThanOrEqual(
        completionStartedAt + UPLOAD_URL_TTL_MS
      )
      expect(await usage(f.organizationId)).toBe(Buffer.byteLength(source))
      const replay = await application.completeProjectFileUploadSession.execute({
        principal: f.principal,
        input: control(f.projectId, session),
      })
      expect(replay.value.file.id).toBe(result.value.file.id)
      expect(await usage(f.organizationId)).toBe(Buffer.byteLength(source))
    }
  )
})

function workbench(f: Awaited<ReturnType<typeof fixture>>, bytes: Buffer) {
  const machine = { providerId: 'daytona' as const, sandboxId: generateId() }
  const sessionKey = generateId()
  const namespace = createHash('sha256')
    .update(
      JSON.stringify([f.workspaceId, f.editorId, sessionKey, machine.providerId, machine.sandboxId])
    )
    .digest('hex')
  const history = createHash('sha256')
    .update(JSON.stringify([sessionKey, machine.providerId, machine.sandboxId]))
    .digest('hex')
  redisKeys.push(
    `mothership:file-source:v1:${namespace}:${createHash('sha256').update(bytes).digest('hex')}`,
    `mothership:workbench-provenance:v2:${history}`
  )
  return {
    machine,
    files: createWorkbenchFileProvenance({
      workspaceId: f.workspaceId,
      userId: f.editorId,
      sessionKey,
    }),
  }
}

async function privateUploadTransport(
  f: Awaited<ReturnType<typeof fixture>>,
  uploadProvenance: () => WorkspaceFileSecretProvenance
) {
  const { createProjectFileUploadTransport } = await import(
    '@/lib/mothership/agent-cli/project-file-upload-transport'
  )
  const { createProjectFileCliTransport } = await import(
    '@/lib/mothership/agent-cli/project-file-transport'
  )
  const { createCopilotResourceAdmission } = await import(
    '@/lib/mothership/auth/application-delegation'
  )
  const context = {
    userId: f.editorId,
    workspaceId: f.workspaceId,
    toolCallId: generateId(),
    copilotToolExecution: true,
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId: f.editorId,
      invocation: { kind: 'workspace', workspaceId: f.workspaceId },
    }),
  }
  const endpoint = 'http://localhost:3000'
  return createProjectFileUploadTransport({
    endpoint,
    projectId: f.projectId,
    context: {
      ...context,
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
        userId: f.editorId,
        workspaceId: f.workspaceId,
      }),
    },
    fallback: createProjectFileCliTransport(endpoint, context, { projectId: f.projectId }),
    uploadProvenance,
  })
}

async function createPrivateUpload(transport: typeof fetch, projectId: string, bytes: Buffer) {
  const { v2CreateProjectFileUploadContract } = await import(
    '@/lib/api/contracts/v2/project-file-uploads'
  )
  const response = await transport(
    `http://localhost:3000/api/v2/projects/${projectId}/files/uploads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'private.bin',
        contentType: 'application/octet-stream',
        size: bytes.length,
      }),
    }
  )
  expect(response.status).toBe(201)
  const created = v2CreateProjectFileUploadContract.response.schema.parse(
    await response.json()
  ).data
  return { created, session: await sessions.verifyUploadSessionToken(created.uploadToken) }
}

function completePrivateUpload(
  transport: typeof fetch,
  projectId: string,
  session: sessions.UploadSessionRecord
) {
  return transport(
    `http://localhost:3000/api/v2/projects/${projectId}/files/uploads/${session.id}/complete`,
    {
      method: 'POST',
      headers: { 'upload-token': session.uploadToken },
    }
  )
}

describe.skipIf(!redisUrl)('private Project upload transport', () => {
  check(
    'private Project upload seals actual streamed source evidence and retains original provenance attribution',
    async () => {
      const { v2CompleteProjectFileUploadContract } = await import(
        '@/lib/api/contracts/v2/project-file-uploads'
      )
      const f = await fixture()
      const bytes = Buffer.from([0, 255, 17, 6, 12])
      const evidence = {
        status: 'exact' as const,
        entries: [
          {
            encryptedValue: 'upload-ciphertext-fixture',
            sourceUserId: f.ownerId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      const { machine, files } = workbench(f, bytes)
      const transport = await privateUploadTransport(f, files.uploadProvenance)
      const downloaded = stream(bytes)
      files.trackDownload(downloaded, evidence)
      await new Response(files.observeDownload(machine, downloaded)).arrayBuffer()
      const { session } = await createPrivateUpload(transport, f.projectId, bytes)
      expect(session.metadata.projectFileSecretProvenance).toMatchObject({
        projectId: f.projectId,
        pending: true,
      })
      await writeLocalPutObject({
        uploadId: session.id,
        key: session.finalKey,
        body: files.observeUpload(machine, stream(bytes)),
        expectedSize: bytes.length,
        contentType: session.contentType,
        metadata: sessions.uploadSessionObjectMetadata(session),
      })
      const response = await completePrivateUpload(transport, f.projectId, session)
      expect(response.status).toBe(200)
      const completed = v2CompleteProjectFileUploadContract.response.schema.parse(
        await response.json()
      ).data
      if (!completed.file) throw new Error('Private upload did not produce a file')
      const [file] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, completed.file.id))
      const [provenance] = await db
        .select()
        .from(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, file.id))
      expect(file).toMatchObject({
        projectId: f.projectId,
        userId: f.editorId,
        workspaceId: null,
      })
      expect(await readFile(join(storageRoot, file.key))).toEqual(bytes)
      expect(provenance).toMatchObject(evidence)
      expect(await usage(f.organizationId)).toBe(bytes.length)
    }
  )

  check(
    'private Project upload refuses incomplete evidence and never upgrades unknown or unrecorded streams to clean',
    async () => {
      const f = await fixture()
      const bytes = Buffer.from('stream source')
      for (const status of ['missing', 'partial', 'unknown', 'unrecorded'] as const) {
        const { machine, files } = workbench(f, bytes)
        const transport = await privateUploadTransport(f, files.uploadProvenance)
        const { session } = await createPrivateUpload(transport, f.projectId, bytes)
        if (status === 'missing' || status === 'partial') {
          const partial =
            status === 'partial'
              ? files
                  .observeUpload(
                    machine,
                    new ReadableStream<Uint8Array>({
                      start(controller) {
                        controller.enqueue(bytes)
                      },
                    })
                  )
                  .getReader()
              : undefined
          if (partial) await partial.read()
          await put(session, bytes)
          const response = await completePrivateUpload(transport, f.projectId, session)
          expect(response.status).toBe(503)
          if (partial) await partial.cancel()
          const current = await sessions.verifyUploadSessionToken(session.uploadToken)
          expect(current.completedFileId).toBeNull()
          expect(current.metadata.projectFileSecretProvenance).toMatchObject({ pending: true })
        } else {
          const downloaded = stream(bytes)
          files.trackDownload(downloaded, { status })
          await new Response(files.observeDownload(machine, downloaded)).arrayBuffer()
          await writeLocalPutObject({
            uploadId: session.id,
            key: session.finalKey,
            body: files.observeUpload(machine, stream(bytes)),
            expectedSize: bytes.length,
            contentType: session.contentType,
            metadata: sessions.uploadSessionObjectMetadata(session),
          })
          const response = await completePrivateUpload(transport, f.projectId, session)
          expect(response.status).toBe(200)
          const current = await sessions.verifyUploadSessionToken(session.uploadToken)
          if (!current.completedFileId) throw new Error('Classified upload did not produce a file')
          const [provenance] = await db
            .select()
            .from(workspaceFileSecretProvenance)
            .where(eq(workspaceFileSecretProvenance.fileId, current.completedFileId))
          expect(provenance).toMatchObject({ status, entries: [] })
        }
      }
      expect(await usage(f.organizationId)).toBe(bytes.length * 2)
    }
  )

  check(
    'private Project upload binds control receipts to the invocation and current owner access',
    async () => {
      const f = await fixture()
      const bytes = Buffer.from('private upload')
      const evidence = () => ({ status: 'unknown' as const })
      const transport = await privateUploadTransport(f, evidence)
      const { session } = await createPrivateUpload(transport, f.projectId, bytes)
      await put(session, bytes)
      const foreignTransport = await privateUploadTransport(f, evidence)
      expect((await completePrivateUpload(foreignTransport, f.projectId, session)).status).toBe(403)
      expect((await completePrivateUpload(transport, generateId(), session)).status).toBe(400)
      expect(
        (
          await transport(`http://localhost:3000/api/v2/projects/${f.projectId}/files/uploads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'forged.bin',
              contentType: 'application/octet-stream',
              size: 1,
              secretProvenance: { status: 'exact', entries: [] },
            }),
          })
        ).status
      ).toBe(400)
      await db.delete(permissions).where(eq(permissions.userId, f.editorId))
      expect((await completePrivateUpload(transport, f.projectId, session)).status).toBe(403)
      expect(
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
      ).toEqual([])
      expect(await usage(f.organizationId)).toBe(0)
      const current = await sessions.verifyUploadSessionToken(session.uploadToken)
      expect(current.completedFileId).toBeNull()
      expect(current.metadata.projectFileSecretProvenance).toMatchObject({ pending: true })
    }
  )
})

afterAll(async () => {
  for (const f of fixtures) {
    await db.delete(uploadSession).where(inArray(uploadSession.userId, [f.ownerId, f.editorId]))
    await db
      .delete(outboxEvent)
      .where(sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/%`}`)
    await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
    await db.delete(folder).where(eq(folder.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, [f.ownerId, f.editorId]))
  }
  await rm(storageRoot, { recursive: true, force: true })
  if (redisKeys.length) await getRedisClient()?.del(...redisKeys)
  await closeRedisConnection()
  const report = process.env.PROJECT_UPLOAD_REPORT_PATH ?? 'test-results/project-upload.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, `${JSON.stringify({ checks }, null, 2)}\n`)
  await db.$client.end()
})
