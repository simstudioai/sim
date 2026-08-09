/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addOutput: vi.fn(),
  createEnrichment: vi.fn(),
  createFromFile: vi.fn(),
  createWorkflowGroup: vi.fn(),
  deleteTables: vi.fn(),
  importFile: vi.fn(),
  replaceProjectedRows: vi.fn(),
  resolvePrincipal: vi.fn(),
  updateWorkflowGroup: vi.fn(),
}))

vi.mock('@/lib/copilot/auth/table-delegation', () => ({
  resolveCopilotTablePrincipal: mocks.resolvePrincipal,
}))
vi.mock('@/lib/table/application/groups', () => ({
  addWorkflowTableGroupOutput: { execute: mocks.addOutput },
  createTableEnrichmentGroup: { execute: mocks.createEnrichment },
  createWorkflowTableGroup: { execute: mocks.createWorkflowGroup },
  updateWorkflowTableGroup: { execute: mocks.updateWorkflowGroup },
}))
vi.mock('@/lib/table/application/copilot-table-lifecycle', () => ({
  deleteCopilotTables: { execute: mocks.deleteTables },
}))
vi.mock('@/lib/table/application/rows', () => ({
  replaceProjectedWireRows: { execute: mocks.replaceProjectedRows },
}))
vi.mock('@/lib/table/application/workspace-file-imports', () => ({
  createTableFromWorkspaceFile: { execute: mocks.createFromFile },
  importWorkspaceFileIntoTable: { execute: mocks.importFile },
}))

import {
  copilotAddWorkflowTableGroupOutputPolicy,
  copilotCreateTableEnrichmentGroupPolicy,
  copilotCreateTableFromWorkspaceFilePolicy,
  copilotCreateWorkflowTableGroupPolicy,
  copilotDeleteTablesPolicy,
  copilotImportWorkspaceFileIntoTablePolicy,
  copilotReplaceProjectedWireRowsPolicy,
  copilotUpdateWorkflowTableGroupPolicy,
  executeCopilotAddWorkflowTableGroupOutput,
  executeCopilotCreateTableEnrichmentGroup,
  executeCopilotCreateTableFromWorkspaceFile,
  executeCopilotCreateWorkflowTableGroup,
  executeCopilotDeleteTables,
  executeCopilotImportWorkspaceFileIntoTable,
  executeCopilotReplaceProjectedWireRows,
  executeCopilotUpdateWorkflowTableGroup,
} from '@/lib/copilot/application/table-commands'

const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
}
const principal = { kind: 'delegated', audience: 'sim:tables' }

describe('fixed Copilot Table application commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePrincipal.mockReturnValue(principal)
  })

  it.each([
    ['replace projected rows', executeCopilotReplaceProjectedWireRows, mocks.replaceProjectedRows],
    ['create workflow group', executeCopilotCreateWorkflowTableGroup, mocks.createWorkflowGroup],
    ['update workflow group', executeCopilotUpdateWorkflowTableGroup, mocks.updateWorkflowGroup],
    ['add workflow output', executeCopilotAddWorkflowTableGroupOutput, mocks.addOutput],
    ['create enrichment group', executeCopilotCreateTableEnrichmentGroup, mocks.createEnrichment],
    ['import a workspace file', executeCopilotImportWorkspaceFileIntoTable, mocks.importFile],
  ])(
    'dispatches %s to exactly one code-defined Table command',
    async (_label, execute, command) => {
      command.mockResolvedValue({ ok: true })
      const input = { tableId: 'table-1', workspaceId: 'workspace-1' }

      await expect(execute(context, input as never)).resolves.toEqual({ ok: true })

      expect(mocks.resolvePrincipal).toHaveBeenCalledWith(context, 'table-1')
      expect(command).toHaveBeenCalledWith({ principal, input })
      expect(command).toHaveBeenCalledTimes(1)
    }
  )

  it('uses a workspace-scoped Table principal for create-from-file', async () => {
    mocks.createFromFile.mockResolvedValue({ kind: 'empty' })
    const input = { workspaceId: 'workspace-1', fileReference: 'files/people.csv' }

    await executeCopilotCreateTableFromWorkspaceFile(context, input)

    expect(mocks.resolvePrincipal).toHaveBeenCalledWith(context)
    expect(mocks.createFromFile).toHaveBeenCalledWith({ principal, input })
  })

  it('uses one workspace-scoped Table command for best-effort multi-table deletion', async () => {
    mocks.deleteTables.mockResolvedValue({ deleted: ['table-1'], failed: ['table-2'] })
    const input = { workspaceId: 'workspace-1', tableIds: ['table-1', 'table-2'] }

    await expect(executeCopilotDeleteTables(context, input)).resolves.toEqual({
      deleted: ['table-1'],
      failed: ['table-2'],
    })

    expect(mocks.resolvePrincipal).toHaveBeenCalledWith(context)
    expect(mocks.deleteTables).toHaveBeenCalledWith({ principal, input })
    expect(mocks.deleteTables).toHaveBeenCalledTimes(1)
  })

  it('declares inherited request-rate admission and no direct provider cost for every command', () => {
    const policies = [
      copilotReplaceProjectedWireRowsPolicy,
      copilotCreateWorkflowTableGroupPolicy,
      copilotDeleteTablesPolicy,
      copilotUpdateWorkflowTableGroupPolicy,
      copilotAddWorkflowTableGroupOutputPolicy,
      copilotCreateTableEnrichmentGroupPolicy,
      copilotCreateTableFromWorkspaceFilePolicy,
      copilotImportWorkspaceFileIntoTablePolicy,
    ]

    for (const policy of policies) {
      expect(policy.rate.kind).toBe('inherited_copilot_request')
      expect(policy.rate.reason).toBeTruthy()
      expect(policy.cost.kind).toBe('none')
      expect(policy.cost.reason).toBeTruthy()
    }
  })

  it('rejects an untrusted context before application execution', async () => {
    const error = new Error('trusted Copilot execution context required')
    mocks.resolvePrincipal.mockImplementationOnce(() => {
      throw error
    })

    expect(() =>
      executeCopilotReplaceProjectedWireRows(undefined, {
        tableId: 'table-1',
        sourceRows: [],
        projectedRows: [],
      })
    ).toThrow(error)
    expect(mocks.replaceProjectedRows).not.toHaveBeenCalled()
  })
})
