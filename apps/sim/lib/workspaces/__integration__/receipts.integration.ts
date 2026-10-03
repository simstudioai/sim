import { db } from '@sim/db'
import { user, workflow, workspace, workspaceOperationReceipt } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  findWorkspaceOperationReceipt,
  insertWorkspaceOperationReceipt,
  lockWorkspaceOperationRequest,
  type WorkspaceOperationReport,
  workflowOperationFingerprint,
} from '@/lib/workspaces/operations/receipts'

const userId = generateId()
const workspaceId = generateId()

describe('workspace receipts against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Workflow fixture',
      email: `${userId}@workflow.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Workflow sync fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
  })
  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  async function apply(
    requestId: string,
    payload: string,
    failAt?: 'resource' | 'receipt' | 'oversize'
  ) {
    const requestHash = workflowOperationFingerprint({ payload })
    return db.transaction(async (tx) => {
      await lockWorkspaceOperationRequest(tx, workspaceId, requestId)
      const existing = await findWorkspaceOperationReceipt(tx, workspaceId, requestId, requestHash)
      if (existing) return existing
      const workflowId = generateId()
      await tx.insert(workflow).values({
        id: workflowId,
        workspaceId,
        userId,
        name: requestId,
        lastSynced: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      if (failAt === 'resource') throw new Error('Injected failure after resource insert')
      const report: WorkspaceOperationReport = {
        operationId: generateId(),
        requestId,
        workspaceId,
        kind: 'workflow_import',
        applied: true,
        status: 'completed',
        resourceIds: [workflowId],
        issues:
          failAt === 'oversize' ? [{ code: 'fixture', message: 'x'.repeat(1024 * 1024) }] : [],
      }
      await insertWorkspaceOperationReceipt(tx, requestHash, report)
      if (failAt === 'receipt') throw new Error('Injected failure after receipt insert')
      return report
    })
  }

  it('commits exactly one business mutation for 20 simultaneous retries', async () => {
    const requestId = generateId()
    const reports = await Promise.all(Array.from({ length: 20 }, () => apply(requestId, 'same')))
    expect(new Set(reports.map((report) => report.operationId)).size).toBe(1)
    const resources = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.name, requestId))
    expect(resources).toHaveLength(1)
    const receipts = await db
      .select({ id: workspaceOperationReceipt.id })
      .from(workspaceOperationReceipt)
      .where(eq(workspaceOperationReceipt.requestId, requestId))
    expect(receipts).toHaveLength(1)
  })

  it('rejects changed payloads under a concurrent request ID', async () => {
    const requestId = generateId()
    const results = await Promise.allSettled([
      apply(requestId, 'first'),
      apply(requestId, 'second'),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  for (const failAt of ['resource', 'receipt', 'oversize'] as const) {
    it(`rolls back both resource and receipt after ${failAt} failure`, async () => {
      const requestId = generateId()
      await expect(apply(requestId, 'payload', failAt)).rejects.toThrow()
      expect(
        await db.select({ id: workflow.id }).from(workflow).where(eq(workflow.name, requestId))
      ).toHaveLength(0)
      expect(
        await db
          .select({ id: workspaceOperationReceipt.id })
          .from(workspaceOperationReceipt)
          .where(eq(workspaceOperationReceipt.requestId, requestId))
      ).toHaveLength(0)
      expect((await apply(requestId, 'payload')).applied).toBe(true)
    })
  }

  it('returns the stored result without repeating work when its resource was subsequently deleted', async () => {
    const requestId = generateId()
    const original = await apply(requestId, 'payload')
    await db.delete(workflow).where(eq(workflow.id, original.resourceIds[0]))
    expect(await apply(requestId, 'payload')).toEqual(original)
    expect(
      await db.select({ id: workflow.id }).from(workflow).where(eq(workflow.name, requestId))
    ).toHaveLength(0)
  })
})
