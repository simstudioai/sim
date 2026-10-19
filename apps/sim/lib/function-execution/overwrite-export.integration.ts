/** Real multi-file Function exports admitting overwrite targets exactly as the writer upserts them. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import { auditLog, organization, user, workspace, workspaceFiles } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { remoteSandboxMock, remoteSandboxMockFns } from '@sim/testing/mocks/remote-sandbox.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
const sandboxEnvironment = vi.hoisted(() => {
  const fixture = {
    SANDBOX_PROVIDER: 'e2b',
    E2B_ENABLED: 'true',
    E2B_API_KEY: 'integration-provider-fixture-not-a-real-key',
    E2B_FUNCTION_TEMPLATE_ID: 'fixture:11111111-1111-4111-8111-111111111111',
    E2B_FUNCTION_TEMPLATE_GENERATION: '1785792000000',
  }
  const previous = Object.entries(fixture).map(([key]) => [key, process.env[key]] as const)
  Object.assign(process.env, fixture)
  return previous
})
vi.mock('@/lib/execution/remote-sandbox', () => remoteSandboxMock)
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { functionExecuteBodySchema } from '@/lib/api/contracts'
import { executeFunctionRequest } from '@/lib/function-execution/execute-request'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createWorkspaceFileFolder } from '@/lib/uploads/contexts/workspace/file-folder-manager'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-function-overwrite-export-'))
})

afterAll(async () => {
  try {
    for (const ids of fixtures) {
      await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
      await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
  } finally {
    for (const [key, value] of sandboxEnvironment) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  }
})

/** A workspace whose admin owns an empty `Reports` folder. */
async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  const folder = await createWorkspaceFileFolder({
    workspaceId: ids.workspaceId,
    userId: ids.aliceId,
    name: 'Reports',
  })
  return { ...ids, folderId: folder.id, workflowId: generateId(), executionId: generateId() }
}

type Fixture = Awaited<ReturnType<typeof seed>>

async function exportTwoFiles(ids: Fixture, overwritePath: string) {
  remoteSandboxMockFns.mockExecuteInSandbox.mockResolvedValueOnce({
    result: 'done',
    stdout: '',
    sandboxId: 'fixture',
    exportedFiles: {
      '/home/user/summary.csv': 'name,total\nnew,2\n',
      '/home/user/notes.txt': 'fresh notes',
    },
  })
  return executeFunctionRequest(
    { headers: new Headers(), signal: AbortSignal.timeout(15_000) },
    functionExecuteBodySchema.parse({
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
      executionId: ids.executionId,
      language: 'python',
      code: 'print("done")',
      outputs: {
        files: [
          { path: overwritePath, mode: 'overwrite', sandboxPath: '/home/user/summary.csv' },
          { path: 'files/Reports/notes.txt', sandboxPath: '/home/user/notes.txt' },
        ],
      },
    }),
    {
      attributedUserId: ids.aliceId,
      fileAccessUserId: ids.aliceId,
      principal: createWorkspaceFileDelegatedPrincipal({
        serviceId: 'executor',
        subjectUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
        delegationId: generateId(),
        executionId: ids.executionId,
      }),
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
        userId: ids.aliceId,
        workspaceId: ids.workspaceId,
      }),
    }
  )
}

function liveFilesInFolder(ids: Fixture) {
  return db
    .select({
      id: workspaceFiles.id,
      name: workspaceFiles.originalName,
      size: workspaceFiles.sizeBytes,
    })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.workspaceId, ids.workspaceId),
        eq(workspaceFiles.folderId, ids.folderId),
        isNull(workspaceFiles.deletedAt)
      )
    )
}

describe('multi-file Function export with overwrite targets', () => {
  it('creates a missing overwrite target instead of failing after the code ran', async () => {
    const ids = await seed()

    const response = await exportTwoFiles(ids, 'files/Reports/summary.csv')
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.success).toBe(true)
    const files = await liveFilesInFolder(ids)
    expect(files.map((file) => file.name).sort()).toEqual(['notes.txt', 'summary.csv'])
    expect(files.find((file) => file.name === 'summary.csv')?.size).toBe(
      Buffer.byteLength('name,total\nnew,2\n')
    )
  })

  it('still replaces an existing overwrite target in place', async () => {
    const ids = await seed()
    const existing = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from('name,total\nold,1\nolder,0\n'),
      'summary.csv',
      'text/csv',
      { folderId: ids.folderId, exactName: true, notifyWorkspaceChange: false }
    )

    const response = await exportTwoFiles(ids, 'files/Reports/summary.csv')
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(200)
    const files = await liveFilesInFolder(ids)
    expect(files.map((file) => file.name).sort()).toEqual(['notes.txt', 'summary.csv'])
    expect(files.find((file) => file.name === 'summary.csv')).toEqual({
      id: existing.id,
      name: 'summary.csv',
      size: Buffer.byteLength('name,total\nnew,2\n'),
    })
  })
})
