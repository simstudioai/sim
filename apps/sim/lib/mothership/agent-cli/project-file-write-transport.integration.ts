import { createHash } from 'node:crypto'
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
  outboxEvent,
  permissions,
  projectWorkspace,
  uploadSession,
  user,
  userStats,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sha256Hex } from '@sim/security/hash'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import {
  remoteSandboxProviderMock,
  remoteSandboxProviderMockFns,
} from '@sim/testing/mocks/remote-sandbox-provider.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const redisUrl = readTestRedisUrl()
  if (redisUrl) process.env.REDIS_URL = redisUrl
  return { redisUrl }
})
vi.mock('@/lib/execution/remote-sandbox/provider', () => remoteSandboxProviderMock)

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import {
  v2CompleteProjectFileUploadContract,
  v2CreateProjectFileUploadContract,
} from '@/lib/api/contracts/v2/project-file-uploads'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  initializeSessionFileProvenance,
  readSessionSecretProvenance,
  recordSessionFileInput,
} from '@/lib/execution/remote-sandbox/session-file-provenance'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { createProjectFileUploadTransport } from '@/lib/mothership/agent-cli/project-file-upload-transport'
import { createProjectFileWriteTransport } from '@/lib/mothership/agent-cli/project-file-write-transport'
import { executeProjectFileCliRequest } from '@/lib/mothership/agent-cli/project-files'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { proxySandboxResourceRequest } from '@/lib/mothership/tools/sandbox-resource-transport'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { writeLocalPutObject } from '@/lib/uploads/upload-session/provider'
import {
  uploadSessionObjectMetadata,
  verifyUploadSessionToken,
} from '@/lib/uploads/upload-session/service'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const callbackRedisKeys: string[] = []
const storageRoot = mkdtempSync(join(tmpdir(), 'sim-project-cli-writes-'))
setUploadDirServer(storageRoot)
const fixtures: {
  userId: string
  workspaceId: string
  projectId: string
  originWorkspaceId?: string
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

async function fixture(crossProject = false) {
  const userId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values({
    id: userId,
    email: `${userId}@private-project.invalid`,
    name: 'Project writer',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(userStats).values({ id: generateId(), userId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId: userId,
    billedAccountUserId: userId,
    name: 'Authoring environment',
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const [binding] = await db
    .select()
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, workspaceId))
  if (!binding) throw new Error('Project fixture missing')
  const originWorkspaceId = crossProject ? generateId() : workspaceId
  if (crossProject) {
    await insertWorkspaceFixture(db, {
      id: originWorkspaceId,
      ownerId: userId,
      billedAccountUserId: userId,
      name: 'Different origin Project',
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: originWorkspaceId,
      permissionType: 'read',
    })
  }
  const ids = { userId, workspaceId, projectId: binding.projectId, originWorkspaceId }
  fixtures.push(ids)
  const context: AgentCliExecutionContext = {
    userId,
    workspaceId: originWorkspaceId,
    requestMode: 'agent',
    copilotToolExecution: true,
    toolCallId: generateId(),
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId,
      invocation: { kind: 'workspace', workspaceId: originWorkspaceId },
    }),
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
      userId,
      workspaceId: originWorkspaceId,
    }),
  }
  return { ...ids, context }
}

function invoke(projectId: string, context: AgentCliExecutionContext, args: string[]) {
  return executeProjectFileCliRequest(
    {
      fileOwner: { entityType: 'project', entityId: projectId },
      invocation: { kind: 'cli', argv: ['projects', 'files', ...args] },
    },
    context,
    projectId
  )
}

function create(
  projectId: string,
  context: AgentCliExecutionContext,
  content = 'Architecture notes',
  encoding = 'utf-8'
) {
  return invoke(projectId, context, [
    'create',
    projectId,
    '--name',
    'architecture.md',
    '--content',
    content,
    '--encoding',
    encoding,
  ])
}

async function rows(projectId: string) {
  return db.select().from(workspaceFiles).where(eq(workspaceFiles.projectId, projectId))
}

describe('private native Project writes against PostgreSQL and local storage', () => {
  for (const [operation, signalOwner] of [
    ['create', 'context'],
    ['update', 'context'],
    ['create', 'request'],
    ['update', 'request'],
  ] as const) {
    check(
      `${signalOwner} cancellation during provenance lookup prevents ${operation}`,
      async () => {
        const f = await fixture()
        if (operation === 'update') expect((await create(f.projectId, f.context)).exitCode).toBe(0)
        const before = await rows(f.projectId)
        const controller = new AbortController()
        const entered = createDeferred<void>()
        const registry = createDeferred<ResolvedSecretTraceRegistry>()
        const endpoint = 'http://localhost:3200'
        const transport = createProjectFileWriteTransport({
          endpoint,
          projectId: f.projectId,
          context: {
            ...f.context,
            signal: signalOwner === 'context' ? controller.signal : undefined,
          },
          resolveSecretTraceRegistry: () => {
            entered.resolve()
            return registry.promise
          },
          fallback: async () => {
            throw new Error('Unexpected fallback')
          },
        })
        const result = transport(
          `${endpoint}/api/v2/projects/${f.projectId}/files${operation === 'update' ? `/${before[0].id}/content` : ''}`,
          {
            method: operation === 'update' ? 'PUT' : 'POST',
            signal: signalOwner === 'request' ? controller.signal : undefined,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              operation === 'update'
                ? {
                    content: 'cancelled content',
                    expectedRevision: workspaceFileRevision(before[0]),
                  }
                : { name: 'cancelled.txt', content: 'cancelled content' }
            ),
          }
        )
        const rejected = expect(result).rejects.toThrow('cancelled during provenance lookup')
        await entered.promise
        controller.abort(new Error('cancelled during provenance lookup'))
        registry.resolve(new ResolvedSecretTraceRegistry([], { userId: f.userId }))
        await rejected
        expect(await rows(f.projectId)).toEqual(before)
        if (operation === 'update')
          expect(await readFile(join(storageRoot, before[0].key), 'utf8')).toBe(
            'Architecture notes'
          )
      }
    )
  }

  check('request bodies and headers cannot mint provenance or Copilot authority', async () => {
    const f = await fixture()
    const endpoint = 'http://localhost:3200'
    const fallback: typeof fetch = async () => {
      throw new Error('Write unexpectedly fell through to public transport')
    }
    const send = (context: AgentCliExecutionContext, extra: Record<string, unknown> = {}) =>
      createProjectFileWriteTransport({ endpoint, projectId: f.projectId, context, fallback })(
        `${endpoint}/api/v2/projects/${f.projectId}/files`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Secret-Provenance': 'exact',
            'X-Copilot-User-Id': f.userId,
          },
          body: JSON.stringify({ name: 'spoof.md', content: 'plain', ...extra }),
        }
      )
    expect(
      (await send(f.context, { secretProvenance: { status: 'exact', entries: [] } })).status
    ).toBe(400)
    expect((await send({ ...f.context, resolvedSecretTraceRegistry: undefined })).status).toBe(403)
    expect((await send({ ...f.context, copilotResourceAdmission: undefined })).status).toBe(403)
    expect(await rows(f.projectId)).toEqual([])
  })

  check(
    'cross-Project inline writes preserve provenance and revision conflicts do not overwrite bytes',
    async () => {
      const f = await fixture(true)
      const created = await create(f.projectId, f.context)
      expect(created.exitCode, created.stderr).toBe(0)
      const [file] = await rows(f.projectId)
      if (!file) throw new Error('Created file missing')
      const [sidecar] = await db
        .select()
        .from(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, file.id))
      expect(sidecar).toMatchObject({ status: 'exact', entries: [] })
      expect(file.userId).toBe(f.userId)
      expect(await readFile(join(storageRoot, file.key), 'utf8')).toBe('Architecture notes')
      const revision = workspaceFileRevision(file)
      if (!revision) throw new Error('Created file has no revision')
      const args = [
        'set-content',
        f.projectId,
        file.id,
        '--content',
        'updated',
        '--expected-revision',
        revision,
      ]
      expect(await invoke(f.projectId, f.context, args)).toMatchObject({ exitCode: 0 })
      expect(
        (await invoke(f.projectId, f.context, [...args.slice(0, 4), 'stale', ...args.slice(5)]))
          .exitCode
      ).not.toBe(0)
      const [updated] = await rows(f.projectId)
      if (!updated) throw new Error('Updated file missing')
      expect(await readFile(join(storageRoot, updated.key), 'utf8')).toBe('updated')
    }
  )

  check(
    'missing or incomplete registries and base64 inputs cannot publish unclassified content',
    async () => {
      const f = await fixture()
      const incomplete = new ResolvedSecretTraceRegistry([], {
        userId: f.userId,
        workspaceId: f.workspaceId,
      })
      incomplete.markIncomplete('entry-decrypt-failed')
      for (const registry of [undefined, incomplete]) {
        const denied = await create(f.projectId, {
          ...f.context,
          resolvedSecretTraceRegistry: registry,
        })
        expect(denied.exitCode, denied.stderr).not.toBe(0)
        expect(denied.stderr).toContain('provenance')
        expect(await rows(f.projectId)).toEqual([])
      }
      expect((await create(f.projectId, f.context, 'cGxhaW4=', 'base64')).exitCode).not.toBe(0)
      expect(await rows(f.projectId)).toEqual([])
    }
  )

  check(
    'known secrets including workspace redaction exemptions cannot be reclassified for a Project',
    async () => {
      const f = await fixture()
      const secret = 'private-project-test-secret-value'
      const { encrypted } = await encryptSecret(secret)
      for (const unredacted of [false, true]) {
        const registry = new ResolvedSecretTraceRegistry(
          [
            {
              name: 'TOKEN',
              plaintext: secret,
              encryptedValue: encrypted,
              scope: 'workspace',
              ...(unredacted ? { unredacted: true as const } : {}),
            },
          ],
          { userId: f.userId, workspaceId: f.workspaceId }
        )
        expect(registry.recordResolved('TOKEN', secret)).toBe(true)
        const denied = await create(
          f.projectId,
          { ...f.context, resolvedSecretTraceRegistry: registry },
          `notes ${secret}`
        )
        expect(denied.exitCode, denied.stderr).not.toBe(0)
        expect(denied.stderr).toContain('provenance')
        expect(await rows(f.projectId)).toEqual([])
      }
    }
  )

  for (const upload of [false, true]) {
    for (const field of ['name', 'folderPath', 'contentType'] as const) {
      check(
        `a secret in Project ${upload ? 'upload' : 'create'} ${field} cannot escape as public metadata`,
        async () => {
          const f = await fixture()
          const secret = 'synthetic-metadata-canary'
          if (field === 'folderPath')
            await db.insert(folder).values({
              id: generateId(),
              projectId: f.projectId,
              resourceType: 'file',
              name: secret,
              userId: f.userId,
            })
          const registry = new ResolvedSecretTraceRegistry(
            [
              {
                name: 'TOKEN',
                plaintext: secret,
                encryptedValue: (await encryptSecret(secret)).encrypted,
                scope: 'workspace',
              },
            ],
            { userId: f.userId, workspaceId: f.workspaceId }
          )
          expect(registry.recordResolved('TOKEN', secret)).toBe(true)
          const transport = (
            upload ? createProjectFileUploadTransport : createProjectFileWriteTransport
          )({
            endpoint: 'http://localhost:3200',
            projectId: f.projectId,
            context: { ...f.context, resolvedSecretTraceRegistry: registry },
            fallback: async () => {
              throw new Error('Unexpected fallback')
            },
          })
          const response = await transport(
            `http://localhost:3200/api/v2/projects/${f.projectId}/files${upload ? '/uploads' : ''}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name: 'safe.txt',
                ...(upload ? { size: 9, contentType: 'text/plain' } : { content: 'safe body' }),
                [field]:
                  field === 'folderPath'
                    ? `/${secret}`
                    : field === 'contentType'
                      ? `text/${secret}`
                      : `${secret}.txt`,
              }),
            }
          )
          expect(response.status, await response.clone().text()).toBe(403)
          expect(await rows(f.projectId)).toEqual([])
          expect(
            await db.select().from(uploadSession).where(eq(uploadSession.userId, f.userId))
          ).toEqual([])
        }
      )
    }
  }

  check('a private target cannot write a different Project', async () => {
    const f = await fixture()
    const other = await fixture()
    expect(
      (
        await invoke(f.projectId, f.context, [
          'create',
          other.projectId,
          '--name',
          'bad.md',
          '--content',
          'plain',
        ])
      ).exitCode
    ).not.toBe(0)
    expect(await rows(other.projectId)).toEqual([])
  })
})

describe.skipIf(!redisUrl)('Project workbench callback across requests', () => {
  check(
    'enforces live callback leases, binds uploads across requests and persists machine source history',
    async () => {
      const f = await fixture()
      const chatId = generateId()
      await db
        .insert(copilotChats)
        .values({ id: chatId, userId: f.userId, workspaceId: f.workspaceId, type: 'mothership' })
      const token = generateId()
      const otherToken = generateId()
      const apiKey = generateId()
      const sessionKey = chatSandboxSessionKey(chatId)
      const machine = { providerId: 'e2b' as const, sandboxId: generateId() }
      remoteSandboxProviderMockFns.mockResolveProvider.mockReturnValue({
        id: machine.providerId,
        findSessionSandbox: async () => ({ sandboxId: machine.sandboxId }),
      })
      const scope = {
        toolCallId: generateId(),
        runId: generateId(),
        userId: f.userId,
        ownerToken: generateId(),
        chatId,
        workspaceId: f.workspaceId,
        apiKeyHash: sha256Hex(apiKey),
        fileOwnerProtocolVersion: 1 as const,
      }
      await db.insert(copilotRuns).values({
        id: scope.runId,
        executionId: generateId(),
        streamId: generateId(),
        chatId,
        userId: f.userId,
        workspaceId: f.workspaceId,
      })
      await db.insert(copilotAsyncToolCalls).values({
        runId: scope.runId,
        toolCallId: scope.toolCallId,
        toolName: 'run_code',
        executionOwnerToken: scope.ownerToken,
        executionStartedAt: new Date(),
        executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      })
      const redis = getRedisClient()
      if (!redis) throw new Error('Expected integration Redis')
      for (const leaseToken of [token, otherToken]) {
        const prefix = `mothership:sandbox-resources:${leaseToken}`
        callbackRedisKeys.push(`${prefix}:context`, `${prefix}:inbox`, `${prefix}:seen`)
        await redis.set(`${prefix}:context`, JSON.stringify(scope), 'EX', 60)
      }
      const historyKey = `mothership:workbench-provenance:v2:${createHash('sha256')
        .update(JSON.stringify([sessionKey, machine.providerId, machine.sandboxId]))
        .digest('hex')}`
      callbackRedisKeys.push(
        historyKey,
        `mothership:sandbox-resources:${token}:project-uploads:${f.projectId}`
      )
      await initializeSessionFileProvenance(sessionKey, machine)
      const callback = (suffix: string, init?: RequestInit, callbackToken = token) => {
        const path = `/api/mothership/sandbox/${callbackToken}/api/v2/projects/${f.projectId}/files${suffix}`
        const headers = new Headers(init?.headers)
        if (!headers.has('x-api-key')) headers.set('x-api-key', apiKey)
        headers.set(
          'x-mothership-file-owner',
          JSON.stringify({ entityType: 'project', entityId: f.projectId })
        )
        return proxySandboxResourceRequest(
          new Request(`http://localhost:3000${path}`, { ...init, headers }),
          callbackToken
        )
      }
      expect((await callback('', { headers: { 'x-api-key': generateId() } })).status).toBe(403)
      const canary = 'synthetic-workbench-callback-canary'
      const evidence = {
        status: 'exact' as const,
        entries: [
          {
            encryptedValue: (await encryptSecret(canary)).encrypted,
            sourceUserId: f.userId,
            sourceWorkspaceId: f.workspaceId,
          },
        ],
      }
      await recordSessionFileInput(sessionKey, machine, evidence)
      const rejected = await callback('', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'unsafe.txt', content: canary, encoding: 'utf-8' }),
      })
      expect(rejected.status).toBe(403)
      const safe = await callback('', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'safe.txt', content: 'safe text', encoding: 'utf-8' }),
      })
      expect(safe.status, await safe.clone().text()).toBe(201)
      await db.insert(folder).values({
        id: generateId(),
        projectId: f.projectId,
        resourceType: 'file',
        name: canary,
        userId: f.userId,
      })
      for (const metadata of [
        { name: `${canary}.txt` },
        { contentType: `text/${canary}` },
        { folderPath: `/${canary}` },
      ]) {
        const denied = await callback('/uploads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'safe.txt',
            contentType: 'text/plain',
            size: 9,
            ...metadata,
          }),
        })
        expect(denied.status, await denied.clone().text()).toBe(403)
        expect(
          await db.select().from(uploadSession).where(eq(uploadSession.userId, f.userId))
        ).toEqual([])
      }
      const bytes = Buffer.from('safe upload')
      const createdResponse = await callback('/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'upload.txt', contentType: 'text/plain', size: bytes.length }),
      })
      expect(createdResponse.status, await createdResponse.clone().text()).toBe(201)
      const created = v2CreateProjectFileUploadContract.response.schema.parse(
        await createdResponse.json()
      ).data
      const upload = await verifyUploadSessionToken(created.uploadToken)
      await writeLocalPutObject({
        uploadId: upload.id,
        key: upload.finalKey,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
        expectedSize: bytes.length,
        contentType: upload.contentType,
        metadata: uploadSessionObjectMetadata(upload),
      })
      const complete = { method: 'POST', headers: { 'upload-token': created.uploadToken } }
      expect((await callback(`/uploads/${upload.id}/complete`, complete, otherToken)).status).toBe(
        403
      )
      const beforeUnattributedUpload = await rows(f.projectId)
      await recordSessionFileInput(sessionKey, machine, {
        status: 'exact',
        entries: [
          { encryptedValue: (await encryptSecret('unattributed synthetic value')).encrypted },
        ],
      })
      expect((await callback(`/uploads/${upload.id}/complete`, complete)).status).toBe(503)
      expect(await rows(f.projectId)).toEqual(beforeUnattributedUpload)
      await redis.del(historyKey)
      await initializeSessionFileProvenance(sessionKey, machine)
      await recordSessionFileInput(sessionKey, machine, evidence)
      const response = await callback(`/uploads/${upload.id}/complete`, complete)
      expect(response.status, await response.clone().text()).toBe(200)
      const completed = v2CompleteProjectFileUploadContract.response.schema.parse(
        await response.json()
      ).data
      if (!completed.file) throw new Error('Expected completed upload')
      const [stored] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, completed.file.id))
      const [provenance] = await db
        .select()
        .from(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, completed.file.id))
      expect(stored).toMatchObject({ projectId: f.projectId, workspaceId: null, userId: f.userId })
      expect(provenance).toMatchObject(evidence)
      const freshMachine = { ...machine, sandboxId: generateId() }
      remoteSandboxProviderMockFns.mockResolveProvider.mockReturnValue({
        id: freshMachine.providerId,
        findSessionSandbox: async () => ({ sandboxId: freshMachine.sandboxId }),
      })
      callbackRedisKeys.push(
        `mothership:workbench-provenance:v2:${createHash('sha256')
          .update(JSON.stringify([sessionKey, freshMachine.providerId, freshMachine.sandboxId]))
          .digest('hex')}`
      )
      await initializeSessionFileProvenance(sessionKey, freshMachine)
      expect(await readSessionSecretProvenance(sessionKey, freshMachine)).toEqual({
        status: 'exact',
        entries: [],
      })
      const read = await callback(`/${completed.file.id}/content`, undefined, otherToken)
      expect(read.status).toBe(200)
      expect(await read.text()).toBe('safe upload')
      expect(await readSessionSecretProvenance(sessionKey, freshMachine)).toEqual(evidence)
      const effects = (
        await redis.lrange(`mothership:sandbox-resources:${token}:inbox`, 0, -1)
      ).map((entry) => JSON.parse(entry))
      expect(effects.length).toBeGreaterThan(0)
      for (const effect of effects) {
        expect(effect.resource.owner).toEqual({ entityType: 'project', entityId: f.projectId })
        expect(effect.resource.workspaceId).toBeUndefined()
      }
      await db
        .update(copilotAsyncToolCalls)
        .set({ executionRevokedAt: new Date() })
        .where(eq(copilotAsyncToolCalls.toolCallId, scope.toolCallId))
      expect((await callback(`/${completed.file.id}/content`)).status).toBe(403)
    }
  )
})

afterAll(async () => {
  if (callbackRedisKeys.length) await getRedisClient()?.del(...callbackRedisKeys)
  for (const f of fixtures) {
    await db
      .delete(outboxEvent)
      .where(sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/%`}`)
    await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
    await db.delete(folder).where(eq(folder.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    if (f.originWorkspaceId && f.originWorkspaceId !== f.workspaceId)
      await deleteWorkspaceFixture(db, eq(workspace.id, f.originWorkspaceId))
    await db.delete(user).where(eq(user.id, f.userId))
  }
  await rm(storageRoot, { recursive: true, force: true })
  const report =
    process.env.PROJECT_FILE_WRITE_TRANSPORT_REPORT_PATH ??
    'test-results/project-file-write-transport.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
  await closeRedisConnection()
  await db.$client.end()
})
