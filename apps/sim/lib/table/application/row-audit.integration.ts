import { db } from '@sim/db'
import {
  auditLog,
  permissions,
  user,
  userTableDefinitions,
  userTableRows,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { storageServiceMock } from '@sim/testing/mocks/storage-service.mock'
import { tableBillingMock, tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/trigger', () => tableTriggerMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import {
  createTableRows,
  deleteTableRow,
  replaceTableRows,
  updateTableRow,
  updateTableRows,
  upsertTableRow,
} from '@/lib/table/application/rows'

describe('table mutation audit history in PostgreSQL', () => {
  let userId: string
  let workspaceId: string
  let tableId: string
  let rowId: string
  const privateValue = 'table-cell-must-not-enter-audit-metadata'

  beforeEach(async () => {
    userId = generateId()
    workspaceId = generateId()
    tableId = generateId()
    rowId = generateId()
    const now = new Date()
    tableBillingMockFns.mockAssertRowCapacity.mockResolvedValue(10_000)
    await db.insert(user).values({
      id: userId,
      name: 'Table audit fixture',
      email: `${userId}@audit.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Table audit fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    await db.insert(userTableDefinitions).values({
      id: tableId,
      workspaceId,
      name: 'Audited table',
      createdBy: userId,
      schema: { columns: [{ id: 'value', name: 'value', type: 'string', unique: true }] },
    })
    await db.insert(userTableRows).values({
      id: rowId,
      tableId,
      workspaceId,
      data: { value: 'original' },
      orderKey: 'a0',
    })
  })

  afterEach(async () => {
    await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  const cases = [
    {
      name: 'single insert',
      operation: 'tables.rows.create',
      countField: 'rowsInserted',
      count: 1,
    },
    { name: 'batch insert', operation: 'tables.rows.create', countField: 'rowsInserted', count: 2 },
    { name: 'single update', operation: 'tables.rows.update', countField: 'rowsUpdated', count: 1 },
    {
      name: 'filter update',
      operation: 'tables.rows.update_many',
      countField: 'rowsUpdated',
      count: 1,
    },
    { name: 'single delete', operation: 'tables.rows.delete', countField: 'rowsDeleted', count: 1 },
    { name: 'replace', operation: 'tables.rows.replace', countField: 'rowsInserted', count: 1 },
    {
      name: 'upsert insert',
      operation: 'tables.rows.upsert',
      countField: 'rowsInserted',
      count: 1,
    },
    { name: 'upsert update', operation: 'tables.rows.upsert', countField: 'rowsUpdated', count: 1 },
  ] as const

  it.each(cases)('persists a scoped, content-free record for $name', async (testCase) => {
    const principal = createSessionPrincipal({ userId })
    const common = { tableId, assertedWorkspaceId: workspaceId }
    const write = { ...common, strictWrite: true, dataKeying: 'ids' as const }
    if (testCase.name === 'single insert' || testCase.name === 'batch insert') {
      await createTableRows.execute({
        principal,
        input:
          testCase.name === 'single insert'
            ? { ...write, kind: 'single', data: { value: privateValue } }
            : { ...write, kind: 'batch', rows: [{ value: privateValue }, { value: 'another' }] },
      })
    } else if (testCase.name === 'single update') {
      await updateTableRow.execute({
        principal,
        input: { ...write, rowId, data: { value: privateValue } },
      })
    } else if (testCase.name === 'filter update') {
      await updateTableRows.execute({
        principal,
        input: { ...write, filter: { value: 'original' }, data: { value: privateValue } },
      })
    } else if (testCase.name === 'single delete') {
      await deleteTableRow.execute({ principal, input: { ...common, rowId } })
    } else if (testCase.name === 'replace') {
      await replaceTableRows.execute({
        principal,
        input: { ...write, rows: [{ value: privateValue }] },
      })
    } else {
      await upsertTableRow.execute({
        principal,
        input: {
          ...write,
          conflictTarget: 'value',
          data: { value: testCase.name === 'upsert update' ? 'original' : privateValue },
        },
      })
    }

    await expect
      .poll(async () => {
        const rows = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId))
        return rows.length
      })
      .toBe(1)
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    expect(entry).toMatchObject({
      actorId: userId,
      workspaceId,
      action: 'table.updated',
      resourceType: 'table',
      resourceId: tableId,
      metadata: { operation: testCase.operation, [testCase.countField]: testCase.count },
    })
    expect(JSON.stringify(entry)).not.toContain(privateValue)
  })
})
