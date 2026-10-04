import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  folder,
  outboxEvent,
  permissions,
  projectWorkspace,
  user,
  userStats,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { encryptSecret } from '@/lib/core/security/encryption'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { createProjectFileWriteTransport } from '@/lib/mothership/agent-cli/project-file-write-transport'
import { executeProjectFileCliRequest } from '@/lib/mothership/agent-cli/project-files'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const storageRoot = mkdtempSync(join(tmpdir(), 'sim-project-cli-writes-'))
setUploadDirServer(storageRoot)
const fixtures: { userId: string; workspaceId: string; projectId: string }[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

beforeEach(() => {
  vi.stubEnv('PROJECT_API_ENABLED', 'true')
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
  return db
    .select()
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.entityType, 'project'), eq(workspaceFiles.entityId, projectId)))
}

describe('private native Project writes against PostgreSQL and local storage', () => {
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
    'clean inline text persists exact-empty provenance and shared revision conflicts do not overwrite bytes',
    async () => {
      const f = await fixture()
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

afterAll(async () => {
  for (const f of fixtures) {
    await db
      .delete(outboxEvent)
      .where(sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/%`}`)
    await db
      .delete(workspaceFiles)
      .where(
        and(eq(workspaceFiles.entityType, 'project'), eq(workspaceFiles.entityId, f.projectId))
      )
    await db
      .delete(folder)
      .where(and(eq(folder.entityType, 'project'), eq(folder.entityId, f.projectId)))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(user).where(eq(user.id, f.userId))
  }
  await rm(storageRoot, { recursive: true, force: true })
  const report =
    process.env.PROJECT_FILE_WRITE_TRANSPORT_REPORT_PATH ??
    'test-results/project-file-write-transport.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
  await db.$client.end()
})
