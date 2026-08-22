/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeTableUseCase: vi.fn(),
  useCases: {
    addOutput: { operation: { id: 'tables.groups.update' } },
    createEnrichment: { operation: { id: 'tables.groups.create' } },
    createFromFile: { operation: { id: 'tables.imports.create_from_workspace_file' } },
    createWorkflowGroup: { operation: { id: 'tables.groups.create' } },
    deleteTables: { operation: { id: 'tables.delete' } },
    importFile: { operation: { id: 'tables.imports.prepare_file_edit' } },
    replaceProjectedRows: { operation: { id: 'tables.rows.replace' } },
    updateWorkflowGroup: { operation: { id: 'tables.groups.update' } },
  },
}))

vi.mock('@/lib/copilot/application/execute-table-use-case', () => ({
  executeCopilotTableUseCase: mocks.executeTableUseCase,
}))
vi.mock('@/lib/table/application/groups', () => ({
  addWorkflowTableGroupOutput: mocks.useCases.addOutput,
  createTableEnrichmentGroup: mocks.useCases.createEnrichment,
  createWorkflowTableGroup: mocks.useCases.createWorkflowGroup,
  updateWorkflowTableGroup: mocks.useCases.updateWorkflowGroup,
}))
vi.mock('@/lib/table/application/copilot-table-lifecycle', () => ({
  deleteCopilotTables: mocks.useCases.deleteTables,
}))
vi.mock('@/lib/table/application/rows', () => ({
  replaceProjectedWireRows: mocks.useCases.replaceProjectedRows,
}))
vi.mock('@/lib/table/application/workspace-file-imports', () => ({
  createTableFromWorkspaceFile: mocks.useCases.createFromFile,
  importWorkspaceFileIntoTable: mocks.useCases.importFile,
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
describe('fixed Copilot Table application commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [
      'replace projected rows',
      executeCopilotReplaceProjectedWireRows,
      mocks.useCases.replaceProjectedRows,
    ],
    [
      'create workflow group',
      executeCopilotCreateWorkflowTableGroup,
      mocks.useCases.createWorkflowGroup,
    ],
    [
      'update workflow group',
      executeCopilotUpdateWorkflowTableGroup,
      mocks.useCases.updateWorkflowGroup,
    ],
    ['add workflow output', executeCopilotAddWorkflowTableGroupOutput, mocks.useCases.addOutput],
    [
      'create enrichment group',
      executeCopilotCreateTableEnrichmentGroup,
      mocks.useCases.createEnrichment,
    ],
    [
      'import a workspace file',
      executeCopilotImportWorkspaceFileIntoTable,
      mocks.useCases.importFile,
    ],
  ])(
    'dispatches %s to exactly one code-defined Table command',
    async (_label, execute, useCase) => {
      mocks.executeTableUseCase.mockResolvedValue({ ok: true })
      const input = { tableId: 'table-1', workspaceId: 'workspace-1' }

      await expect(execute(context, input as never)).resolves.toEqual({ ok: true })

      expect(mocks.executeTableUseCase).toHaveBeenCalledWith(context, useCase, input, {
        tableId: 'table-1',
      })
      expect(mocks.executeTableUseCase).toHaveBeenCalledTimes(1)
    }
  )

  it('uses a workspace-scoped Table principal for create-from-file', async () => {
    mocks.executeTableUseCase.mockResolvedValue({ kind: 'empty' })
    const input = { workspaceId: 'workspace-1', fileReference: 'files/people.csv' }

    await executeCopilotCreateTableFromWorkspaceFile(context, input)

    expect(mocks.executeTableUseCase).toHaveBeenCalledWith(
      context,
      mocks.useCases.createFromFile,
      input
    )
  })

  it('uses one workspace-scoped Table command for best-effort multi-table deletion', async () => {
    const result = {
      deleted: [{ id: 'table-1', name: 'People' }],
      failed: ['table-2'],
    }
    mocks.executeTableUseCase.mockResolvedValue(result)
    const input = {
      workspaceId: 'workspace-1',
      tableIds: ['table-1', 'table-2'],
      assertNotAborted: vi.fn(),
    }

    await expect(executeCopilotDeleteTables(context, input)).resolves.toBe(result)

    expect(mocks.executeTableUseCase).toHaveBeenCalledWith(
      context,
      mocks.useCases.deleteTables,
      input
    )
    expect(mocks.executeTableUseCase).toHaveBeenCalledTimes(1)
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
    mocks.executeTableUseCase.mockImplementationOnce(() => {
      throw error
    })

    expect(() =>
      executeCopilotReplaceProjectedWireRows(undefined, {
        tableId: 'table-1',
        sourceRows: [],
        projectedRows: [],
      })
    ).toThrow(error)
    expect(mocks.executeTableUseCase).toHaveBeenCalledTimes(1)
  })
})
