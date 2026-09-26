import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { requestUtilsMockFns } from '@sim/testing/mocks/request.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/table', () => tableMock)
vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)

import { deleteCopilotTables } from '@/lib/table/application/copilot-table-lifecycle'

const mocks = {
  deleteTable: tableMockFns.mockDeleteTable,
  resolveActiveTableContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  resolveWorkspaceContext: tableApplicationContextMockFns.mockResolveTableWorkspaceContext,
  audit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createDelegatedPrincipal({
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  resourceScope: { chatId: 'chat-1' },
})

describe('deleteCopilotTables', () => {
  beforeEach(() => {
    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('request-1')
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolveActiveTableContext.mockImplementation(
      async ({ tableId }: { tableId: string }) => ({
        tableId,
        workspaceId: 'workspace-1',
      })
    )
    mocks.deleteTable.mockImplementation(async (tableId: string) => ({
      archived: { name: `Table ${tableId}`, workspaceId: 'workspace-1' },
    }))
  })

  it('conceals a cross-workspace table as a best-effort miss', async () => {
    mocks.resolveActiveTableContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Table not found')
    )

    await expect(
      deleteCopilotTables.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          tableIds: ['table-other'],
          assertNotAborted: vi.fn(),
        },
      })
    ).resolves.toEqual({ deleted: [], failed: ['table-other'] })

    expect(mocks.deleteTable).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects admission before canonical loads or mutation', async () => {
    mocks.resolvePermission.mockResolvedValueOnce(null)

    await expect(
      deleteCopilotTables.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          tableIds: ['table-1'],
          assertNotAborted: vi.fn(),
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveActiveTableContext).not.toHaveBeenCalled()
    expect(mocks.deleteTable).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('does not project partial audit when the compound command fails', async () => {
    const failure = new Error('delete storage unavailable')
    mocks.deleteTable
      .mockResolvedValueOnce({
        archived: { name: 'Table table-1', workspaceId: 'workspace-1' },
      })
      .mockRejectedValueOnce(failure)

    await expect(
      deleteCopilotTables.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          tableIds: ['table-1', 'table-2'],
          assertNotAborted: vi.fn(),
        },
      })
    ).rejects.toBe(failure)

    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('checks cancellation immediately before each archive and stops partial progress', async () => {
    const canceled = new Error('Request aborted before tool mutation could be applied')
    const assertNotAborted = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw canceled
      })

    await expect(
      deleteCopilotTables.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          tableIds: ['table-1', 'table-2'],
          assertNotAborted,
        },
      })
    ).rejects.toBe(canceled)

    expect(mocks.resolveActiveTableContext).toHaveBeenCalledTimes(2)
    expect(mocks.deleteTable).toHaveBeenCalledTimes(1)
    expect(mocks.deleteTable).toHaveBeenCalledWith('table-1', 'request-1', {
      expectedWorkspaceId: 'workspace-1',
    })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
