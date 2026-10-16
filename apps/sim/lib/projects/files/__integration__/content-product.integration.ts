import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  folder,
  idempotencyKey,
  member,
  organization,
  outboxEvent,
  permissions,
  subscription,
  user,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const redisUrl = readTestRedisUrl()
  if (redisUrl) process.env.REDIS_URL = redisUrl
  return { redisUrl }
})

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

import { v2CopyFileItemsContract } from '@/lib/api/contracts/v2/file-copy'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { createFileCopyCliTransport } from '@/lib/mothership/agent-cli/file-copy-transport'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { proxySandboxResourceRequest } from '@/lib/mothership/tools/sandbox-resource-transport'
import { listProjectsServerTool } from '@/lib/mothership/tools/server/project-list'
import { createProjectFile } from '@/lib/projects/files/application/content'
import { exportProjectFileSnapshot } from '@/lib/projects/files/application/downloads'
import { createProjectFileFolder } from '@/lib/projects/files/application/folders'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import { replaceWorkspaceFileSecretProvenanceInTx } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import * as storage from '@/lib/uploads/core/storage-service'

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
  const [binding] = await db
    .select({ projectId: workspace.projectId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
  if (!binding?.projectId) throw new Error('Project fixture missing')
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

async function ledger(organizationId: string) {
  const [row] = await db
    .select({ bytes: organization.storageUsedBytes })
    .from(organization)
    .where(eq(organization.id, organizationId))
  return row?.bytes
}

check(
  'Project discovery accepts its opaque pagination cursor through the tool boundary',
  async () => {
    const f = await fixture()
    const result = await listProjectsServerTool.execute(
      { cursor: 'zz-legacy-project', limit: 1 },
      {
        userId: f.editorId,
        workspaceId: f.workspaceId,
        toolCallId: generateId(),
        copilotToolExecution: true,
        copilotResourceAdmission: createCopilotResourceAdmission({
          userId: f.editorId,
          invocation: { kind: 'workspace', workspaceId: f.workspaceId },
        }),
      }
    )
    expect(result).toMatchObject({ success: true, projects: [], nextCursor: null })
  }
)

describe.skipIf(!redisUrl)('authenticated workbench copy callback', () => {
  check(
    'organization callback copies both owners with current access, provenance and durable effects',
    async () => {
      const f = await fixture()
      const foreign = await fixture()
      const destinationWorkspaceId = generateId()
      await insertWorkspaceFixture(db, {
        id: destinationWorkspaceId,
        ownerId: f.ownerId,
        billedAccountUserId: f.ownerId,
        organizationId: f.organizationId,
        workspaceMode: 'organization',
        name: 'Copy destination',
      })
      const [destinationBinding] = await db
        .select({ projectId: workspace.projectId })
        .from(workspace)
        .where(eq(workspace.id, destinationWorkspaceId))
      if (!destinationBinding?.projectId) throw new Error('Destination Project missing')
      const destinationPermissionId = generateId()
      await db.insert(permissions).values({
        id: destinationPermissionId,
        userId: f.editorId,
        entityType: 'workspace',
        entityId: destinationWorkspaceId,
        permissionType: 'write',
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'callback copy bytes'),
      })
      const evidence = {
        status: 'exact' as const,
        entries: [
          {
            encryptedValue: 'synthetic-encrypted-evidence',
            sourceUserId: f.editorId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      const [sourceRow] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, source.file.id))
      await db.transaction((tx) =>
        replaceWorkspaceFileSecretProvenanceInTx(
          tx,
          source.file.id,
          sourceRow.contentUpdatedAt,
          evidence
        )
      )
      const [sourceProvenance] = await db
        .select()
        .from(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, source.file.id))
      const chatId = generateId()
      await db.insert(copilotChats).values({
        id: chatId,
        userId: f.editorId,
        organizationId: f.organizationId,
        type: 'mothership',
        config: { conversationMode: 'agent' },
      })
      const token = generateId()
      const apiKey = generateId()
      const scope = {
        toolCallId: generateId(),
        runId: generateId(),
        userId: f.editorId,
        ownerToken: generateId(),
        chatId,
        organizationId: f.organizationId,
        apiKeyHash: sha256Hex(apiKey),
        fileOwnerProtocolVersion: 1 as const,
      }
      await db.insert(copilotRuns).values({
        id: scope.runId,
        executionId: generateId(),
        streamId: generateId(),
        chatId,
        userId: f.editorId,
        organizationId: f.organizationId,
      })
      await db.insert(copilotAsyncToolCalls).values({
        runId: scope.runId,
        toolCallId: scope.toolCallId,
        toolName: 'run_code',
        executionOwnerToken: scope.ownerToken,
        executionStartedAt: new Date(),
        executionLeaseExpiresAt: new Date(Date.now() + 120_000),
      })
      const redis = getRedisClient()
      if (!redis) throw new Error('Expected callback Redis')
      const prefix = `mothership:sandbox-resources:${token}`
      await redis.set(`${prefix}:context`, JSON.stringify(scope), 'EX', 120)
      const sourceOwner = { entityType: 'project' as const, entityId: f.projectId }
      const destinationOwner = {
        entityType: 'workspace' as const,
        entityId: destinationWorkspaceId,
      }
      const body = {
        source: { owner: sourceOwner, fileIds: [source.file.id], folderIds: [] },
        destination: { owner: destinationOwner, folderId: null },
      }
      const callback = (
        value: unknown = body,
        headers: Record<string, string> = {},
        method = 'POST'
      ) =>
        proxySandboxResourceRequest(
          new Request(`http://localhost:3000/api/mothership/sandbox/${token}/api/v2/files/copy`, {
            method,
            headers: { 'content-type': 'application/json', 'x-api-key': apiKey, ...headers },
            ...(method === 'POST' ? { body: JSON.stringify(value) } : {}),
          }),
          token
        )
      const destinationRows = () =>
        db
          .select()
          .from(workspaceFiles)
          .where(eq(workspaceFiles.workspaceId, destinationWorkspaceId))
      try {
        const controller = new AbortController()
        controller.abort()
        await expect(
          proxySandboxResourceRequest(
            new Request(`http://localhost:3000/api/mothership/sandbox/${token}/api/v2/files/copy`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
              body: JSON.stringify(body),
              signal: controller.signal,
            }),
            token
          )
        ).rejects.toMatchObject({ name: 'AbortError' })
        expect(await destinationRows()).toEqual([])
        const response = await callback()
        expect(response.status, await response.clone().text()).toBe(201)
        const result = v2CopyFileItemsContract.response.schema.parse(await response.json()).data
        const [copied] = await destinationRows()
        expect(copied).toMatchObject({
          id: result.files[0]?.id,
          userId: f.editorId,
          workspaceId: destinationWorkspaceId,
          projectId: null,
        })
        expect(await readFile(join(localStorageRoot, copied.key), 'utf8')).toBe(
          'callback copy bytes'
        )
        const [provenance] = await db
          .select()
          .from(workspaceFileSecretProvenance)
          .where(eq(workspaceFileSecretProvenance.fileId, copied.id))
        expect(provenance).toMatchObject({
          status: sourceProvenance.status,
          entries: sourceProvenance.entries,
        })
        const effects = (await redis.lrange(`${prefix}:inbox`, 0, -1)).map((entry) =>
          JSON.parse(entry)
        )
        expect(effects).toContainEqual(
          expect.objectContaining({
            op: 'upsert',
            resource: expect.objectContaining({ id: copied.id, owner: destinationOwner }),
          })
        )
        const [chat] = await db.select().from(copilotChats).where(eq(copilotChats.id, chatId))
        expect(JSON.stringify(chat)).toContain(copied.id)
        const reverse = await callback({
          source: { owner: destinationOwner, fileIds: [copied.id], folderIds: [] },
          destination: {
            owner: { entityType: 'project', entityId: destinationBinding.projectId },
            folderId: null,
          },
        })
        expect(reverse.status, await reverse.clone().text()).toBe(201)
        for (const input of [
          {
            ...body,
            destination: {
              owner: { entityType: 'project', entityId: destinationBinding.projectId },
              folderId: null,
            },
          },
          {
            source: { owner: destinationOwner, fileIds: [copied.id], folderIds: [] },
            destination: {
              owner: { entityType: 'workspace', entityId: f.workspaceId },
              folderId: null,
            },
          },
        ]) {
          const copiedResponse = await callback(input)
          expect(copiedResponse.status, await copiedResponse.clone().text()).toBe(201)
        }
        await db
          .update(copilotChats)
          .set({ organizationId: null, workspaceId: f.workspaceId })
          .where(eq(copilotChats.id, chatId))
        await db
          .update(copilotRuns)
          .set({ organizationId: null, workspaceId: f.workspaceId })
          .where(eq(copilotRuns.id, scope.runId))
        await redis.set(
          `${prefix}:context`,
          JSON.stringify({ ...scope, organizationId: undefined, workspaceId: f.workspaceId }),
          'EX',
          120
        )
        expect((await callback()).status).toBe(201)
        await db
          .update(copilotChats)
          .set({ organizationId: f.organizationId, workspaceId: null })
          .where(eq(copilotChats.id, chatId))
        await db
          .update(copilotRuns)
          .set({ organizationId: f.organizationId, workspaceId: null })
          .where(eq(copilotRuns.id, scope.runId))
        await redis.set(`${prefix}:context`, JSON.stringify(scope), 'EX', 120)
        vi.stubEnv('PROJECTS', 'false')
        featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
        expect((await callback()).status).toBe(503)
        const deniedProjectRead = await proxySandboxResourceRequest(
          new Request(
            `http://localhost:3000/api/mothership/sandbox/${token}/api/v2/projects/${f.projectId}/files`,
            {
              headers: {
                'x-api-key': apiKey,
                'x-mothership-file-owner': JSON.stringify(sourceOwner),
              },
            }
          ),
          token
        )
        expect(deniedProjectRead.status).toBe(503)
        vi.stubEnv('PROJECTS', 'true')
        featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
          async (flag) => flag === 'projects'
        )
        expect((await callback()).status).toBe(201)
        const baseline = await destinationRows()
        const invalidHeaders: Record<string, string>[] = [
          { 'x-api-key': generateId() },
          { 'x-mothership-workspace-id': f.workspaceId },
          { 'x-mothership-file-owner': JSON.stringify(sourceOwner) },
        ]
        for (const headers of invalidHeaders)
          expect((await callback(body, headers)).status).toBe(403)
        expect((await callback(body, {}, 'GET')).status).toBe(405)
        expect((await callback({ ...body, workspaceId: f.workspaceId })).status).toBe(400)
        await redis.set(
          `${prefix}:context`,
          JSON.stringify({ ...scope, fileOwnerProtocolVersion: undefined }),
          'EX',
          120
        )
        expect((await callback()).status).toBe(403)
        await redis.set(`${prefix}:context`, JSON.stringify(scope), 'EX', 120)
        for (const invalid of [
          {
            ...body,
            source: {
              ...body.source,
              owner: { entityType: 'project', entityId: foreign.projectId },
            },
          },
          {
            ...body,
            destination: {
              ...body.destination,
              owner: { entityType: 'workspace', entityId: foreign.workspaceId },
            },
          },
          { ...body, source: { ...body.source, fileIds: [generateId()] } },
          { ...body, destination: { ...body.destination, folderId: generateId() } },
        ])
          expect((await callback(invalid)).ok).toBe(false)
        await db
          .update(permissions)
          .set({ permissionType: 'read' })
          .where(eq(permissions.id, destinationPermissionId))
        expect((await callback()).ok).toBe(false)
        await db
          .update(permissions)
          .set({ permissionType: 'write' })
          .where(eq(permissions.id, destinationPermissionId))
        const [sourcePermission] = await db
          .select()
          .from(permissions)
          .where(and(eq(permissions.userId, f.editorId), eq(permissions.entityId, f.workspaceId)))
        await db.delete(permissions).where(eq(permissions.id, sourcePermission.id))
        expect((await callback()).ok).toBe(false)
        await db.insert(permissions).values(sourcePermission)
        const download = storage.downloadFile
        let revoked = false
        const read = vi.spyOn(storage, 'downloadFile').mockImplementation(async (options) => {
          const bytes = await download(options)
          if (!revoked) {
            revoked = true
            await db
              .update(permissions)
              .set({ permissionType: 'read' })
              .where(eq(permissions.id, destinationPermissionId))
          }
          return bytes
        })
        try {
          expect((await callback()).ok).toBe(false)
          expect(revoked).toBe(true)
        } finally {
          read.mockRestore()
        }
        await db
          .update(permissions)
          .set({ permissionType: 'write' })
          .where(eq(permissions.id, destinationPermissionId))
        await db
          .update(copilotAsyncToolCalls)
          .set({ executionRevokedAt: new Date() })
          .where(eq(copilotAsyncToolCalls.toolCallId, scope.toolCallId))
        expect((await callback()).status).toBe(403)
        expect(await destinationRows()).toEqual(baseline)
      } finally {
        await redis.del(`${prefix}:context`, `${prefix}:inbox`, `${prefix}:seen`)
        await db
          .delete(workspaceFiles)
          .where(eq(workspaceFiles.projectId, destinationBinding.projectId))
        await deleteWorkspaceFixture(db, eq(workspace.id, destinationWorkspaceId))
      }
    }
  )
})

describe('private compound copy transport', () => {
  check(
    'native paired copy dispatch returns the destination resource and persists the current actor bytes',
    async () => {
      const f = await fixture()
      const original = await uploadWorkspaceFile(
        f.workspaceId,
        f.ownerId,
        Buffer.from('native paired copy bytes'),
        'native-copy.txt',
        'text/plain'
      )
      const destinationFolder = await createProjectFileFolder.execute({
        principal: f.principal,
        input: { projectId: f.projectId, name: 'Architecture' },
      })
      const target = {
        source: {
          owner: { entityType: 'workspace' as const, entityId: f.workspaceId },
          fileIds: [original.id],
          folderIds: [],
        },
        destination: {
          owner: { entityType: 'project' as const, entityId: f.projectId },
          folderId: destinationFolder.folder.id,
        },
      }
      const result = await executeAgentCliRequest(
        {
          invocation: {
            kind: 'file-copy',
            ...target,
            argv: [
              'files',
              'copy',
              '--source',
              JSON.stringify(target.source),
              '--destination',
              JSON.stringify(target.destination),
            ],
          },
        },
        {
          userId: f.editorId,
          workspaceId: f.workspaceId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.editorId,
            invocation: { kind: 'workspace', workspaceId: f.workspaceId },
          }),
        }
      )
      expect(result, result.stderr).toMatchObject({ exitCode: 0 })
      const [copied] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.projectId, f.projectId))
      if (!copied) throw new Error('Native paired copy created no durable Project file')
      expect(copied.id).not.toBe(original.id)
      expect(copied.userId).toBe(f.editorId)
      expect(copied.folderId).toBe(destinationFolder.folder.id)
      expect(await storage.downloadFile({ key: copied.key, context: 'project' })).toEqual(
        Buffer.from('native paired copy bytes')
      )
      expect(result.resources).toContainEqual({
        op: 'upsert',
        resource: {
          type: 'file',
          owner: target.destination.owner,
          id: copied.id,
          title: 'native-copy.txt',
          path: `projects/${f.projectId}/files/Architecture/native-copy.txt`,
        },
      })
    }
  )

  check(
    'private copy transport retains the acting user through the real v2 route and stored bytes',
    async () => {
      const f = await fixture()
      const original = await createProjectFile.execute({
        principal: createSessionPrincipal({ userId: f.ownerId }),
        input: createInput(f.projectId, 'private compound copy bytes'),
      })
      const input = {
        source: {
          owner: { entityType: 'project' as const, entityId: f.projectId },
          fileIds: [original.file.id],
          folderIds: [],
        },
        destination: {
          owner: { entityType: 'workspace' as const, entityId: f.workspaceId },
          folderId: null,
        },
      }
      const transport = createFileCopyCliTransport(
        'http://localhost:3000',
        {
          userId: f.editorId,
          workspaceId: f.workspaceId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.editorId,
            invocation: { kind: 'workspace', workspaceId: f.workspaceId },
          }),
        },
        input
      )
      const before = await ledger(f.organizationId)
      const response = await transport('http://localhost:3000/api/v2/files/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      expect(response.status).toBe(201)
      const [copied] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.workspaceId, f.workspaceId))
      if (!copied || copied.sizeBytes === null)
        throw new Error('Private copy created no sized durable file')
      expect(copied.userId).toBe(f.editorId)
      expect(copied.id).not.toBe(original.file.id)
      expect(await storage.downloadFile({ key: copied.key, context: 'workspace' })).toEqual(
        Buffer.from('private compound copy bytes')
      )
      expect(await ledger(f.organizationId)).toBe(before + copied.sizeBytes)
    }
  )

  check(
    'private copy transport binds immutable selections and refuses changed owners, routes and revoked access',
    async () => {
      const f = await fixture()
      const original = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const input = {
        source: {
          owner: { entityType: 'project' as const, entityId: f.projectId },
          fileIds: [original.file.id],
          folderIds: [],
        },
        destination: {
          owner: { entityType: 'workspace' as const, entityId: f.workspaceId },
          folderId: null,
        },
      }
      const expected = structuredClone(input)
      const transport = createFileCopyCliTransport(
        'http://localhost:3000',
        {
          userId: f.editorId,
          workspaceId: f.workspaceId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.editorId,
            invocation: { kind: 'workspace', workspaceId: f.workspaceId },
          }),
        },
        input
      )
      input.source.fileIds.push(generateId())
      for (const body of [
        input,
        { ...expected, destination: { ...expected.destination, folderId: generateId() } },
        {
          ...expected,
          source: { ...expected.source, owner: { entityType: 'project', entityId: generateId() } },
        },
      ]) {
        expect(
          (
            await transport('http://localhost:3000/api/v2/files/copy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          ).status
        ).toBe(403)
      }
      expect(
        (await transport(`http://localhost:3000/api/v2/projects/${f.projectId}/files`)).status
      ).toBe(400)
      expect(
        (
          await transport('http://other.invalid/api/v2/files/copy', {
            method: 'POST',
            body: JSON.stringify(expected),
          })
        ).status
      ).toBe(400)
      await db.delete(permissions).where(eq(permissions.userId, f.editorId))
      expect(
        (
          await transport('http://localhost:3000/api/v2/files/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expected),
          })
        ).status
      ).toBe(403)
      expect(
        await db.select().from(workspaceFiles).where(eq(workspaceFiles.workspaceId, f.workspaceId))
      ).toEqual([])
    }
  )
})

describe('Project archive download and Markdown snapshot export', () => {
  check(
    'Project Markdown snapshot export accepts parameterized alias MIME without a Markdown extension',
    async () => {
      const f = await fixture()
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, 'draft'),
          name: 'notes.txt',
          contentType: 'Text/X-Markdown; charset=utf-8',
        },
      })
      const exported = await exportProjectFileSnapshot.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, content: '# Selected draft' },
      })
      expect(exported.buffer.toString('utf8')).toBe('# Selected draft')
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
    process.env.PROJECT_FILE_CONTENT_PRODUCT_REPORT_PATH ??
    'test-results/project-file-content-product.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
  await closeRedisConnection()
  await db.$client.end()
})
