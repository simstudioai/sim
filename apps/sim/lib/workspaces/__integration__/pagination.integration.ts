import { db } from '@sim/db'
import { permissions, user, workspace, workspaceOperationReceipt } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { v2ForkChildrenQuerySchema } from '@/lib/api/contracts/v2/workspace-fork'
import { v2ListWorkspaceOperationsQuerySchema } from '@/lib/api/contracts/v2/workspace-operations'
import { listWorkspaceOperations } from '@/lib/workspaces/operations/application'
import type { WorkspaceOperationReport } from '@/lib/workspaces/operations/receipts'
import { listWorkspaceForkChildren } from '@/ee/workspace-forking/application/discovery'

const userId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const principal = { kind: 'personal_api_key' as const, userId, keyId: generateId() }
const childIds = Array.from({ length: 4 }, () => generateId()).sort()
const operationIds = Array.from({ length: 4 }, () => generateId()).sort()
const timestamps = [
  '2026-09-09 12:34:56.123001',
  '2026-09-09 12:34:56.123999',
  '2026-09-09 12:34:56.123456',
  '2026-09-09 12:34:56.123456',
]
const descendingIndices = [1, 3, 2, 0]

describe('workspace pagination against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Pagination fixture',
      email: `${userId}@workflow.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values(
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: 'Pagination parent fixture',
        ownerId: userId,
        billedAccountUserId: userId,
        allowPersonalApiKeys: true,
      }))
    )
    await db.insert(permissions).values(
      [workspaceId, otherWorkspaceId].map((id) => ({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: id,
        permissionType: 'admin' as const,
      }))
    )
    await db.insert(workspace).values(
      childIds.map((id, index) => ({
        id,
        name: `Pagination child ${index}`,
        ownerId: userId,
        billedAccountUserId: userId,
        forkedFromWorkspaceId: workspaceId,
        /** Bind PostgreSQL timestamps directly so fixture construction preserves microseconds. */
        createdAt: sql`${timestamps[index]}::timestamp`,
      }))
    )
    await db.insert(workspaceOperationReceipt).values(
      operationIds.map((id, index) => {
        const report: WorkspaceOperationReport = {
          operationId: id,
          requestId: generateId(),
          workspaceId,
          kind: 'workspace_fork',
          applied: true,
          status: 'completed',
          resourceIds: [childIds[index]],
          issues: [],
        }
        return {
          id,
          workspaceId,
          requestId: report.requestId,
          requestHash: 'pagination-fixture',
          kind: report.kind,
          report,
          createdAt: sql`${timestamps[index]}::timestamp`,
        }
      })
    )
  })

  afterAll(async () => {
    await db
      .delete(workspace)
      .where(inArray(workspace.id, [...childIds, workspaceId, otherWorkspaceId]))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('lists every operation once in descending order across microsecond and identical-timestamp boundaries', async () => {
    let cursor: string | undefined
    for (const [pageIndex, rowIndex] of descendingIndices.entries()) {
      const page = await listWorkspaceOperations.execute({
        principal,
        input: {
          workspaceId,
          ...v2ListWorkspaceOperationsQuerySchema.parse({ limit: 1, cursor }),
        },
      })
      expect(page.operations.map((operation) => operation.operationId)).toEqual([
        operationIds[rowIndex],
      ])
      if (pageIndex === descendingIndices.length - 1) {
        expect(page.nextCursor).toBeNull()
      } else {
        expect(page.nextCursor).toEqual(expect.any(String))
      }
      cursor = page.nextCursor ?? undefined
    }
  })

  it('refuses an operation cursor under another workspace the principal can access', async () => {
    const first = await listWorkspaceOperations.execute({
      principal,
      input: { workspaceId, limit: 1 },
    })
    expect(first.nextCursor).not.toBeNull()
    await expect(
      listWorkspaceOperations.execute({
        principal,
        input: { workspaceId: otherWorkspaceId, limit: 1, cursor: first.nextCursor! },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('lists every fork child once in the supported descending order within one millisecond', async () => {
    let cursor: string | undefined
    for (const [pageIndex, rowIndex] of descendingIndices.entries()) {
      const page = await listWorkspaceForkChildren.execute({
        principal,
        input: { workspaceId, ...v2ForkChildrenQuerySchema.parse({ limit: 1, cursor }) },
      })
      expect(page.items.map((child) => child.id)).toEqual([childIds[rowIndex]])
      expect(page.items[0].createdAt).toBe('2026-09-09T12:34:56.123Z')
      if (pageIndex === descendingIndices.length - 1) {
        expect(page.nextCursor).toBeNull()
      } else {
        expect(page.nextCursor).toEqual(expect.any(String))
      }
      cursor = page.nextCursor ?? undefined
    }
  })

  it('refuses a fork child cursor under another parent the principal can access', async () => {
    const query = v2ForkChildrenQuerySchema.parse({ limit: 1 })
    const first = await listWorkspaceForkChildren.execute({
      principal,
      input: { workspaceId, ...query },
    })
    expect(first.nextCursor).not.toBeNull()
    await expect(
      listWorkspaceForkChildren.execute({
        principal,
        input: { workspaceId: otherWorkspaceId, ...query, cursor: first.nextCursor! },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
})
