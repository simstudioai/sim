import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { tableMock } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const hoisted = vi.hoisted(() => ({
  findUnmigrated: vi.fn(),
  performUpdate: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/table', () => tableMock)
vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)
vi.mock('@/lib/table/columns/workflow-references', () => ({
  findUnmigratedTableBlockReferences: hoisted.findUnmigrated,
}))
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/orchestration', () => ({ performUpdateTableColumn: hoisted.performUpdate }))

import { updateTableColumnUseCase } from '@/lib/table/application/columns'

const mocks = {
  ...hoisted,
  resolveContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  audit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  signal: tableEventsMockFns.mockSignalTableSchemaChanged,
}

const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: {
    columns: [
      { id: 'column-name', name: 'name', type: 'string' },
      { id: 'column-first', name: 'first', type: 'string' },
      { id: 'column-last', name: 'last', type: 'string' },
    ],
  },
  metadata: null,
  rowCount: 0,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'owner-1',
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}
const principal = createDelegatedPrincipal({
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  resourceScope: { tableId: 'table-1' },
})

/**
 * A rename leaves workflow Table blocks pointing at the old name — nothing
 * rewrites workflow state, lint stays clean, and the next run fails inside an
 * error edge. The use case reports those blocks so the caller can migrate them.
 */
describe('column rename application use case', () => {
  const unmigrated = [
    {
      workflowId: 'wf-1',
      workflowName: 'Alerts',
      blockId: 'blk-1',
      blockName: 'Query',
      fields: ['filter' as const],
    },
  ]

  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveContext.mockResolvedValue({
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.findUnmigrated.mockResolvedValue(unmigrated)
  })

  function update(updates: { name?: string; required?: boolean }) {
    mocks.performUpdate.mockResolvedValue({
      success: true,
      table: {
        ...table,
        schema: {
          columns: table.schema.columns.map((column) =>
            column.name === 'first' ? { ...column, ...updates } : column
          ),
        },
      },
    })
    return updateTableColumnUseCase.execute({
      principal,
      input: { tableId: 'table-1', workspaceId: 'workspace-1', columnName: 'first', updates },
    })
  }

  it('reports the workflow Table blocks a rename did not migrate', async () => {
    const result = await update({ name: 'given' })

    expect(mocks.findUnmigrated).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      tableId: 'table-1',
      columnName: 'first',
    })
    expect(result.unmigrated).toEqual(unmigrated)
    expect(result.changed).toBe(true)
  })

  it('reports nothing rather than failing a rename that already committed when the scan fails', async () => {
    mocks.findUnmigrated.mockRejectedValue(new Error('workflow tables unavailable'))

    const result = await update({ name: 'given' })

    expect(result.unmigrated).toEqual([])
    expect(result.table.schema.columns[1].name).toBe('given')
  })
})
