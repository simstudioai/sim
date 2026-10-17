import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  permissions,
  user,
  userStats,
  workspace,
  workspaceFileSearchBuild,
  workspaceFileSearchChunk,
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
import { eq, inArray, or } from 'drizzle-orm'
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

import { observeContentDelivery } from '@/lib/core/application/content-delivery'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import { type AgentCliExecutionContext, executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery'
import type { AgentCliAugmentationInvocation } from '@/lib/mothership/generated/agent-cli'
import { projectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
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
  vi.stubEnv('PROJECTS', 'true')
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
    .select({ projectId: workspace.projectId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
  if (!binding?.projectId) throw new Error('Project fixture missing')
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

/** Chat runs every CLI call under the tool executor's registry gate; reads here do the same. */
function runCli(
  request: Parameters<typeof executeAgentCliRequest>[0],
  context: AgentCliExecutionContext
) {
  const gate = createRegistryContentGate({
    registry: context.resolvedSecretTraceRegistry,
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
  })
  return observeContentDelivery(gate, () => executeAgentCliRequest(request, context))
}

function read(
  projectId: string,
  context: AgentCliExecutionContext,
  reference: string,
  flags: AgentCliAugmentationInvocation['flags'] = {},
  name = 'files read'
) {
  return runCli(
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

check(
  'Project files without recorded provenance stay readable, as workspace files do',
  async () => {
    const f = await fixture()
    const { file } = await createProjectFile.execute({
      principal: f.principal,
      input: {
        projectId: f.projectId,
        name: 'legacy-notes.txt',
        contentType: 'text/plain',
        content: 'legacy-line',
        encoding: 'utf-8',
      },
    })
    // As stored when an unrecorded workspace file is copied into a Project.
    await db
      .update(workspaceFileSecretProvenance)
      .set({ status: 'unrecorded', entries: [] })
      .where(eq(workspaceFileSecretProvenance.fileId, file.id))
    const result = await read(f.projectId, f.context, file.id)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).text).toContain('legacy-line')
    const grep = await read(f.projectId, f.context, 'legacy-line', {}, 'grep')
    expect(grep.exitCode, grep.stderr).toBe(0)
    expect(grep.stdout).toContain(':1: legacy-line')
  }
)

check(
  'a Project file with no text decoder reads as binary metadata, as in a workspace',
  async () => {
    const f = await fixture()
    const { file } = await createProjectFile.execute({
      principal: f.principal,
      input: {
        projectId: f.projectId,
        name: 'archive.bin',
        contentType: 'application/octet-stream',
        content: Buffer.from([0, 1, 2, 3, 255]).toString('base64'),
        encoding: 'base64',
      },
    })
    const result = await read(f.projectId, f.context, file.id)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      representation: 'binary',
      contentAvailable: false,
    })
  }
)

check('Project grep searches files when no scope is given', async () => {
  const f = await fixture()
  const { file } = await createProjectFile.execute({
    principal: f.principal,
    input: {
      projectId: f.projectId,
      name: 'unscoped-notes.txt',
      contentType: 'text/plain',
      content: 'alpha\nunscoped-needle\nomega',
      encoding: 'utf-8',
    },
  })
  const result = await read(f.projectId, f.context, 'unscoped-needle', {}, 'grep')
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.stdout).toContain(`files/unscoped-notes.txt (${file.id}):2:`)
})

check('benchmark reference generation cannot create Project files', async () => {
  const f = await fixture()
  const name = `read-only-${generateId()}.txt`
  const result = await runCli(
    {
      fileOwner: { entityType: 'project', entityId: f.projectId },
      invocation: {
        kind: 'cli',
        argv: ['projects', 'files', 'create', f.projectId, '--name', name, '--content', 'x'],
      },
    },
    { ...f.context, readOnly: true }
  )
  expect(result.exitCode).not.toBe(0)
  expect(result.stdout + result.stderr).toContain('can only read')
  const stored = () =>
    db
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.originalName, name))
  expect(await stored()).toEqual([])
  // The same command creates the file outside reference generation.
  const created = await runCli(
    {
      fileOwner: { entityType: 'project', entityId: f.projectId },
      invocation: {
        kind: 'cli',
        argv: ['projects', 'files', 'create', f.projectId, '--name', name, '--content', 'x'],
      },
    },
    f.context
  )
  expect(created.exitCode, created.stderr).toBe(0)
  expect(await stored()).toHaveLength(1)
})

check('Project grep matches public bytes while excluding classified secret text', async () => {
  const f = await fixture()
  const secret = 'synthetic-project-grep-canary'
  const { encrypted } = await encryptSecret(secret)
  const { file } = await createProjectFile.execute({
    principal: f.principal,
    input: {
      projectId: f.projectId,
      name: 'grep-notes.txt',
      contentType: 'text/plain',
      content: `before\n${secret}\nafter`,
      encoding: 'utf-8',
      secretProvenance: {
        status: 'exact',
        entries: [
          {
            encryptedValue: encrypted,
            sourceUserId: f.userId,
            sourceWorkspaceId: f.workspaceId,
            name: 'CANARY',
          },
        ],
      },
    },
  })
  const result = await read(
    f.projectId,
    f.context,
    'canary',
    { scope: 'files', in: `files/${file.id}` },
    'grep'
  )
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.stdout).toContain('No matches')
  expect(result.stdout).not.toContain(secret)
  const visible = await read(
    f.projectId,
    f.context,
    'before',
    { scope: 'files', in: `files/${file.id}` },
    'grep'
  )
  expect(visible.exitCode, visible.stderr).toBe(0)
  expect(visible.stdout).toContain(`files/grep-notes.txt (${file.id}):1:`)
  expect(visible.stdout).not.toContain(secret)

  // Text reads match workspace files: admission imports the provenance, so the model egress
  // masks the secret while every other line stays readable. A line window is redacted before it
  // is cut, so it never holds a fragment the egress could miss.
  const egress = (output: unknown) =>
    JSON.stringify(
      projectToolResultForCopilot({ success: true, output }, f.context.resolvedSecretTraceRegistry)
    )
  const whole = await read(f.projectId, f.context, file.id)
  expect(whole.exitCode, whole.stderr).toBe(0)
  expect(JSON.parse(whole.stdout)).toMatchObject({ representation: 'text' })
  const wholeEgress = egress(JSON.parse(whole.stdout))
  expect(wholeEgress).toContain('before')
  expect(wholeEgress).toContain('after')
  expect(wholeEgress).not.toContain(secret)
  const ranged = await read(f.projectId, f.context, file.id, { offset: '2', limit: '1' })
  expect(ranged.exitCode, ranged.stderr).toBe(0)
  expect(JSON.parse(ranged.stdout).lineRange).toMatchObject({ offset: 2, lineCount: 1 })
  expect(ranged.stdout).not.toContain(secret)

  // Byte reads stay opaque: no redaction reaches bytes, so a secret still refuses them.
  const bytes = await read(f.projectId, f.context, file.id, {}, 'files view')
  expect(bytes.exitCode).not.toBe(0)
  expect(bytes.stdout + bytes.stderr).not.toContain(secret)
})

check('raw Project source downloads refuse known secrets outside a workbench session', async () => {
  const f = await fixture()
  const secret = 'synthetic-project-source-canary'
  const { encrypted } = await encryptSecret(secret)
  const source = (fileId: string) =>
    runCli(
      {
        fileOwner: { entityType: 'project', entityId: f.projectId },
        invocation: { kind: 'cli', argv: ['projects', 'files', 'source', f.projectId, fileId] },
      },
      f.context
    )
  const { file: secretFile } = await createProjectFile.execute({
    principal: f.principal,
    input: {
      projectId: f.projectId,
      name: 'source-secret.txt',
      contentType: 'text/plain',
      content: `before\n${secret}\nafter`,
      encoding: 'utf-8',
      secretProvenance: {
        status: 'exact',
        entries: [
          {
            encryptedValue: encrypted,
            sourceUserId: f.userId,
            sourceWorkspaceId: f.workspaceId,
            name: 'CANARY',
          },
        ],
      },
    },
  })
  const refused = await source(secretFile.id)
  expect(refused.exitCode).not.toBe(0)
  expect(refused.stderr).toContain(
    'File cannot be sent to a model because its secret provenance is unavailable'
  )
  expect(refused.stdout + refused.stderr).not.toContain(secret)

  const { file: publicFile } = await createProjectFile.execute({
    principal: f.principal,
    input: {
      projectId: f.projectId,
      name: 'source-public.txt',
      contentType: 'text/plain',
      content: 'public-source-bytes',
      encoding: 'utf-8',
      secretProvenance: { status: 'exact', entries: [] },
    },
  })
  const delivered = await source(publicFile.id)
  expect(delivered.exitCode, delivered.stderr).toBe(0)
  expect(delivered.stdout).toContain('public-source-bytes')
})

describe('Project CLI representations against PostgreSQL and stored bytes', () => {
  check(
    'native workspace content search reaches its collection operation instead of a file named search',
    async () => {
      const f = await fixture()
      const result = await runCli(
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
    'native indexed workspace delivery withholds secret-bearing and untracked excerpts',
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
      const result = await runCli({ fileOwner: owner, invocation }, f.context)
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).results[0].fileId).toBe(file.id)
      expect(JSON.parse(result.stdout).results[0].text).toContain('Preview withheld')
      expect(result.stdout).not.toContain('root-native-secret')
      expect(result.stdout).not.toContain('input-native-secret')
      await db
        .delete(workspaceFileSecretProvenance)
        .where(eq(workspaceFileSecretProvenance.fileId, dependency.id))
      const rejected = await runCli(
        { fileOwner: owner, invocation },
        {
          ...f.context,
          resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
            userId: f.userId,
            workspaceId: f.workspaceId,
          }),
        }
      )
      expect(rejected.exitCode, rejected.stderr).toBe(0)
      expect(JSON.parse(rejected.stdout).results[0].text).toContain('Preview withheld')
      expect(rejected.stdout).not.toContain('input-native-secret')
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
      const explicit = await runCli({ fileOwner: owner, invocation }, f.context)
      expect(explicit.exitCode, explicit.stderr).toBe(0)
      expect(explicit.stdout).toContain(file.id)
      expect(explicit.resources).toContainEqual({
        op: 'upsert',
        readOnly: true,
        resource: expect.objectContaining({ type: 'file', id: file.id, owner }),
      })
      const legacy = await runCli({ workspaceId: f.workspaceId, invocation }, f.context)
      expect(legacy.exitCode, legacy.stderr).toBe(0)
      expect(legacy.stdout).toBe(explicit.stdout)
      await expect(
        runCli({ fileOwner: owner, workspaceId: generateId(), invocation }, f.context)
      ).rejects.toMatchObject({ code: 'validation' })
      const other = await fixture()
      await expect(
        runCli({ fileOwner: { ...owner, entityId: other.workspaceId }, invocation }, f.context)
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
  if (fixtures.length) {
    const buildIds = (
      await db
        .select({ id: workspaceFileSearchBuild.id })
        .from(workspaceFileSearchBuild)
        .where(
          or(
            inArray(
              workspaceFileSearchBuild.workspaceId,
              fixtures.map((f) => f.workspaceId)
            ),
            inArray(
              workspaceFileSearchBuild.entityId,
              fixtures.map((f) => f.projectId)
            )
          )
        )
    ).map((row) => row.id)
    if (buildIds.length) {
      await db
        .delete(workspaceFileSearchChunk)
        .where(inArray(workspaceFileSearchChunk.buildId, buildIds))
      await db
        .delete(workspaceFileSearchBuild)
        .where(inArray(workspaceFileSearchBuild.id, buildIds))
    }
  }
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
