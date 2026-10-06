import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  permissions,
  projectWorkspace,
  user,
  userStats,
  workspace,
  workspaceFileSearchRevision,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { Document, Packer, Paragraph } from 'docx'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const redisUrl = readTestRedisUrl()
  if (redisUrl) process.env.REDIS_URL = redisUrl
  return { redisUrl }
})

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { closeRedisConnection } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import { type AgentCliExecutionContext, executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import type { AgentCliAugmentationInvocation } from '@/lib/mothership/generated/agent-cli'
import { createProjectFile } from '@/lib/projects/files/application'
import { storeCompiledDoc } from '@/lib/uploads/documents/compiled-store'
import { fileDocumentInputIdentity } from '@/lib/uploads/documents/input-identity'
import { createWorkspaceFile } from '@/lib/workspace-files/application/create-workspace-file'
import { indexWorkspaceFileForSearch } from '@/lib/workspace-files/search/indexing'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const storageRoot = mkdtempSync(join(tmpdir(), 'sim-project-cli-reads-'))
setUploadDirServer(storageRoot)
const fixtures: { userId: string; workspaceId: string; projectId: string }[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  vi.stubEnv('PROJECT_FILES_ENABLED', 'true')
  vi.stubEnv('FREE_STORAGE_LIMIT_GB', '')
})

function check(name: string, run: () => Promise<void>, requiresRedis = false) {
  it.skipIf(requiresRedis && !redisUrl)(name, async () => {
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
  const userId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values({
    id: userId,
    email: `${userId}@project-read.invalid`,
    name: 'File reader',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(userStats).values({ id: generateId(), userId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId: userId,
    billedAccountUserId: userId,
    name: 'Read environment',
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
  const ids = { userId, workspaceId, projectId: binding.projectId }
  fixtures.push(ids)
  const context: AgentCliExecutionContext = {
    userId,
    workspaceId,
    requestMode: 'agent',
    copilotToolExecution: true,
    toolCallId: generateId(),
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId,
      invocation: { kind: 'workspace', workspaceId },
    }),
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], { userId, workspaceId }),
  }
  const principal = createSessionPrincipal({ userId })
  return { ...ids, context, principal }
}

function read(
  projectId: string,
  context: AgentCliExecutionContext,
  reference: string,
  flags: AgentCliAugmentationInvocation['flags'] = {},
  name = 'files read'
) {
  return executeAgentCliRequest(
    {
      fileOwner: { entityType: 'project', entityId: projectId },
      invocation: { kind: 'augmentation', name, positionals: [reference], flags },
    },
    context
  )
}

async function imageContent() {
  return (
    await sharp(Buffer.from([25, 80, 150, 255]), {
      raw: { width: 1, height: 1, channels: 4 },
    })
      .png()
      .toBuffer()
  ).toString('base64')
}

describe('Project CLI representations against PostgreSQL and stored bytes', () => {
  check(
    'native workspace content search reaches its collection operation instead of a file named search',
    async () => {
      const f = await fixture()
      const result = await executeAgentCliRequest(
        {
          fileOwner: { entityType: 'workspace', entityId: f.workspaceId },
          invocation: {
            kind: 'cli',
            argv: ['files', 'search', '--query', 'absent-needle', '--mode', 'exact'],
          },
        },
        f.context
      )
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ count: 0, results: [], complete: true })
    }
  )

  check(
    'native indexed workspace delivery imports root and input secrets and denies missing input tracking',
    async () => {
      const f = await fixture()
      const owner = { entityType: 'workspace' as const, entityId: f.workspaceId }
      const { encrypted: rootSecret } = await encryptSecret('root-native-secret')
      const { encrypted: inputSecret } = await encryptSecret('input-native-secret')
      const create = async (name: string, content: string, encryptedValue: string) =>
        createWorkspaceFile.execute({
          principal: f.principal,
          input: {
            workspaceId: f.workspaceId,
            name,
            contentType: 'text/plain',
            content,
            encoding: 'utf-8',
            exactName: true,
            secretProvenance: {
              status: 'exact',
              entries: [
                { encryptedValue, sourceUserId: f.userId, sourceWorkspaceId: f.workspaceId },
              ],
            },
          },
        })
      const { file: dependency } = await create('input.txt', 'input-native-secret', inputSecret)
      const source = `getFileBase64('${dependency.id}')`
      const { file } = await create('generated.docx', source, rootSecret)
      const [inputRow] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, dependency.id))
      const artifact = await Packer.toBuffer(
        new Document({
          sections: [
            {
              children: [
                new Paragraph('nativeprovenanceneedle root-native-secret input-native-secret'),
              ],
            },
          ],
        })
      )
      await storeCompiledDoc(
        owner,
        source,
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        artifact,
        fileDocumentInputIdentity(owner, [inputRow])
      )
      const token = new Date()
      const [revision] = await db
        .update(workspaceFileSearchRevision)
        .set({ dispatchedAt: token })
        .where(eq(workspaceFileSearchRevision.fileId, file.id))
        .returning()
      await indexWorkspaceFileForSearch(
        {
          owner,
          fileId: file.id,
          sourceContentUpdatedAt: revision.sourceContentUpdatedAt.toISOString(),
          dispatchToken: token.toISOString(),
        },
        new AbortController().signal
      )
      const invocation = {
        kind: 'cli' as const,
        argv: ['files', 'search', '--query', 'nativeprovenanceneedle', '--mode', 'exact'],
      }
      const result = await executeAgentCliRequest({ fileOwner: owner, invocation }, f.context)
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).results[0].fileId).toBe(file.id)
      expect(f.context.resolvedSecretTraceRegistry?.exportProvenance()).toMatchObject({
        complete: true,
        entries: expect.arrayContaining([
          expect.objectContaining({ encryptedValue: rootSecret }),
          expect.objectContaining({ encryptedValue: inputSecret }),
        ]),
      })
      await db
        .delete(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, dependency.id))
      const rejected = await executeAgentCliRequest(
        { fileOwner: owner, invocation },
        {
          ...f.context,
          resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
            userId: f.userId,
            workspaceId: f.workspaceId,
          }),
        }
      )
      expect(rejected.exitCode).not.toBe(0)
      expect(rejected.stdout).toBe('')
    },
    true
  )

  check(
    'explicit workspace file owners preserve native reads and reject conflicting invocation scope',
    async () => {
      const f = await fixture()
      const { file } = await createWorkspaceFile.execute({
        principal: f.principal,
        input: {
          workspaceId: f.workspaceId,
          name: 'workspace-owner.md',
          contentType: 'text/markdown',
          content: 'Canonical workspace documentation',
          encoding: 'utf-8',
          exactName: true,
        },
      })
      const owner = { entityType: 'workspace' as const, entityId: f.workspaceId }
      const invocation = { kind: 'cli' as const, argv: ['files', 'describe', file.id] }
      const explicit = await executeAgentCliRequest({ fileOwner: owner, invocation }, f.context)
      expect(explicit.exitCode, explicit.stderr).toBe(0)
      expect(explicit.stdout).toContain(file.id)
      expect(explicit.resources).toContainEqual({
        op: 'upsert',
        readOnly: true,
        resource: expect.objectContaining({ type: 'file', id: file.id, owner }),
      })
      const legacy = await executeAgentCliRequest(
        { workspaceId: f.workspaceId, invocation },
        f.context
      )
      expect(legacy.exitCode, legacy.stderr).toBe(0)
      expect(legacy.stdout).toBe(explicit.stdout)
      await expect(
        executeAgentCliRequest(
          { fileOwner: owner, workspaceId: generateId(), invocation },
          f.context
        )
      ).rejects.toMatchObject({ code: 'validation' })
      const other = await fixture()
      await expect(
        executeAgentCliRequest(
          { fileOwner: { ...owner, entityId: other.workspaceId }, invocation },
          f.context
        )
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check(
    'generated Project pages reach the model as rendered documents with canonical ownership',
    async () => {
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          name: 'design.html',
          contentType: 'text/x-sim-page',
          content:
            '---\ntitle: Project architecture\n---\n\n# Shared design\n\nThe durable Project context.',
          encoding: 'utf-8',
        },
      })
      const result = await read(f.projectId, f.context, file.id)
      expect(result.exitCode, result.stderr).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.representation).toBe('text')
      expect(output.type).toBe('text/html')
      expect(output.text).toContain('The durable Project context.')
      expect(output.path).toBe(`projects/${f.projectId}/files/design`)
      expect(result.resources?.[0]).toMatchObject({
        resource: { id: file.id, owner: { entityType: 'project', entityId: f.projectId } },
      })
    }
  )

  check(
    'Project references read the selected owner and preserve text line selection and resource ownership',
    async () => {
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          name: 'architecture.md',
          contentType: 'text/markdown',
          content: 'Heading\nProject line\nEnd',
          encoding: 'utf-8',
        },
      })
      for (const reference of [file.id, `projects/${f.projectId}/files/architecture.md`]) {
        const result = await read(f.projectId, f.context, reference, { offset: '2', limit: '1' })
        expect(result.exitCode, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toMatchObject({
          fileId: file.id,
          path: `projects/${f.projectId}/files/architecture.md`,
          representation: 'text',
          text: 'Project line',
        })
        expect(result.resources).toContainEqual({
          op: 'upsert',
          readOnly: true,
          resource: {
            type: 'file',
            id: file.id,
            title: file.name,
            owner: { entityType: 'project', entityId: f.projectId },
          },
        })
      }
      const invalidFlags: AgentCliAugmentationInvocation['flags'][] = [
        { offset: '1', render: true },
        { limit: true },
        { 'max-bytes': '0' },
        { pages: '' },
      ]
      for (const flags of invalidFlags) {
        const result = await read(f.projectId, f.context, file.id, flags)
        expect(result.exitCode).not.toBe(0)
        expect(result.stdout).toBe('')
      }
      const foreign = await fixture()
      const result = await read(
        f.projectId,
        f.context,
        `projects/${foreign.projectId}/files/architecture.md`
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).toBe('')
    }
  )

  check(
    'visual Project reads expose the authorized image bytes and owner without a workspace file route',
    async () => {
      const f = await fixture()
      const content = await imageContent()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          name: 'diagram.png',
          contentType: 'image/png',
          content,
          encoding: 'base64',
        },
      })
      for (const name of ['files read', 'files view']) {
        const result = await read(f.projectId, f.context, file.id, {}, name)
        expect(result.exitCode, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toMatchObject({
          fileId: file.id,
          representation: 'visual',
          path: `projects/${f.projectId}/files/diagram.png`,
        })
        expect(result.observations).toMatchObject([{ resourceId: file.id, mediaType: 'image/png' }])
        const observation = result.observations?.[0]
        if (!observation) throw new Error('Image observation missing')
        const pixels = await sharp(Buffer.from(observation.data, 'base64'))
          .ensureAlpha()
          .raw()
          .toBuffer()
        expect([...pixels]).toEqual([25, 80, 150, 255])
      }
    }
  )

  check(
    'missing file tracking or a missing caller registry prevents content delivery after a successful metadata lookup',
    async () => {
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          name: 'restricted.md',
          contentType: 'text/markdown',
          content: 'must not be emitted',
          encoding: 'utf-8',
        },
      })
      const missingRegistry = await read(
        f.projectId,
        { ...f.context, resolvedSecretTraceRegistry: undefined },
        file.id
      )
      expect(missingRegistry.exitCode).not.toBe(0)
      expect(missingRegistry.stdout).toBe('')
      expect(missingRegistry.observations).toBeUndefined()
      await db
        .delete(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, file.id))
      const missingTracking = await read(f.projectId, f.context, file.id)
      expect(missingTracking.exitCode).not.toBe(0)
      expect(missingTracking.stdout).toBe('')
      expect(missingTracking.observations).toBeUndefined()
    }
  )

  check(
    'visual content with known secret provenance is not emitted as an opaque model observation',
    async () => {
      const f = await fixture()
      const { encrypted } = await encryptSecret('secret-visible-in-image')
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          name: 'restricted.png',
          contentType: 'image/png',
          content: await imageContent(),
          encoding: 'base64',
          secretProvenance: {
            status: 'exact',
            entries: [
              {
                encryptedValue: encrypted,
                sourceUserId: f.userId,
                sourceWorkspaceId: f.workspaceId,
                name: 'TOKEN',
              },
            ],
          },
        },
      })
      const result = await read(f.projectId, f.context, file.id)
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.observations).toBeUndefined()
    }
  )
})

afterAll(async () => {
  for (const f of fixtures) {
    await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(user).where(eq(user.id, f.userId))
  }
  await rm(storageRoot, { recursive: true, force: true })
  const report = process.env.PROJECT_FILE_READ_REPORT_PATH ?? 'test-results/project-file-read.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
  await closeRedisConnection()
  await db.$client.end()
})
