import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { permissions, user, workflow, workflowBlocks, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readSourceCatalog } from '@/lib/workflows/application/read-source-catalog'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

/**
 * The per-workflow source catalog reads a workflow's stored block types, so the workflow id is
 * an input the caller controls. Against real Postgres: a workflow that belongs to another
 * workspace (one the caller also administers, so only the workspace binding can refuse it) and an
 * archived workflow both answer as not found, while the caller's own active workflow is read,
 * a blockless one included.
 */

const ownerId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const activeWorkflowId = generateId()
const archivedWorkflowId = generateId()
const foreignWorkflowId = generateId()
const blocklessWorkflowId = generateId()
const principal = createSessionPrincipal({ userId: ownerId })
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []

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

function read(workflowId: string) {
  return readSourceCatalog.execute({ principal, input: { workspaceId, workflowId } })
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Code catalog fixture',
    email: `${ownerId}@code-catalog.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(
    db,
    [workspaceId, otherWorkspaceId].map((id) => ({
      id,
      name: 'Code catalog',
      ownerId,
      billedAccountUserId: ownerId,
    }))
  )
  await db.insert(permissions).values(
    [workspaceId, otherWorkspaceId].map((entityId) => ({
      id: generateId(),
      entityType: 'workspace' as const,
      entityId,
      userId: ownerId,
      permissionType: 'admin' as const,
    }))
  )
  await db.insert(workflow).values(
    [
      { id: activeWorkflowId, workspaceId, archivedAt: null },
      { id: archivedWorkflowId, workspaceId, archivedAt: now },
      { id: foreignWorkflowId, workspaceId: otherWorkspaceId, archivedAt: null },
      { id: blocklessWorkflowId, workspaceId, archivedAt: null },
    ].map((row) => ({
      ...row,
      userId: ownerId,
      name: row.id,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(workflowBlocks).values(
    [activeWorkflowId, archivedWorkflowId, foreignWorkflowId].map((workflowId) => ({
      id: generateId(),
      workflowId,
      type: 'function',
      name: 'Function 1',
      positionX: '0',
      positionY: '0',
    }))
  )
})

beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
})

afterAll(async () => {
  const reportPath =
    process.env.WORKFLOW_CODE_CATALOG_REPORT_PATH ??
    resolve('test-results/workflow-code-catalog.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  await db.delete(user).where(eq(user.id, ownerId))
})

check("reads the source catalog for the caller's own active workflow", async () => {
  const catalog = await read(activeWorkflowId)
  expect(Object.hasOwn(catalog.blocks, 'function')).toBe(true)
})

check('answers not found for a workflow that belongs to another workspace', async () => {
  await expect(read(foreignWorkflowId)).rejects.toMatchObject({ code: 'not_found' })
})

check('answers not found for an archived workflow', async () => {
  await expect(read(archivedWorkflowId)).rejects.toMatchObject({ code: 'not_found' })
})

check('reads the workspace catalog for an active workflow with no blocks', async () => {
  const catalog = await read(blocklessWorkflowId)
  expect(Object.hasOwn(catalog.blocks, 'function')).toBe(true)
})
