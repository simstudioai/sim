import { executeCopilotTableUseCase } from '@/lib/mothership/application/execute-table-use-case'
import type { CopilotTableDelegationContext } from '@/lib/mothership/auth/table-delegation'
import {
  type DeleteCopilotTablesInput,
  deleteCopilotTables,
} from '@/lib/table/application/copilot-table-lifecycle'
import {
  type AddTableGroupOutputInput,
  addWorkflowTableGroupOutput,
  type CreateTableEnrichmentGroupInput,
  type CreateWorkflowTableGroupInput,
  createTableEnrichmentGroup,
  createWorkflowTableGroup,
  type UpdateWorkflowTableGroupInput,
  updateWorkflowTableGroup,
} from '@/lib/table/application/groups'
import {
  type ReplaceProjectedWireRowsInput,
  replaceProjectedWireRows,
} from '@/lib/table/application/rows'
import {
  type CreateTableFromWorkspaceFileInput,
  createTableFromWorkspaceFile,
  type ImportWorkspaceFileInput,
  importWorkspaceFileIntoTable,
} from '@/lib/table/application/workspace-file-imports'

const INHERITED_COPILOT_RATE_POLICY = {
  kind: 'inherited_copilot_request',
  reason: 'The authenticated Copilot request owns request-rate admission.',
} as const

const NO_DIRECT_PROVIDER_COST_POLICY = {
  kind: 'none',
  reason: 'This command does not invoke a paid provider; table quota and storage limits apply.',
} as const

export const copilotDeleteTablesPolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotDeleteTables(
  context: CopilotTableDelegationContext | undefined,
  input: DeleteCopilotTablesInput
) {
  return executeCopilotTableUseCase(context, deleteCopilotTables, input)
}

export const copilotReplaceProjectedWireRowsPolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotReplaceProjectedWireRows(
  context: CopilotTableDelegationContext | undefined,
  input: ReplaceProjectedWireRowsInput
) {
  return executeCopilotTableUseCase(context, replaceProjectedWireRows, input, {
    tableId: input.tableId,
  })
}

export const copilotCreateWorkflowTableGroupPolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotCreateWorkflowTableGroup(
  context: CopilotTableDelegationContext | undefined,
  input: CreateWorkflowTableGroupInput
) {
  return executeCopilotTableUseCase(context, createWorkflowTableGroup, input, {
    tableId: input.tableId,
  })
}

export const copilotUpdateWorkflowTableGroupPolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotUpdateWorkflowTableGroup(
  context: CopilotTableDelegationContext | undefined,
  input: UpdateWorkflowTableGroupInput
) {
  return executeCopilotTableUseCase(context, updateWorkflowTableGroup, input, {
    tableId: input.tableId,
  })
}

export const copilotAddWorkflowTableGroupOutputPolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotAddWorkflowTableGroupOutput(
  context: CopilotTableDelegationContext | undefined,
  input: AddTableGroupOutputInput
) {
  return executeCopilotTableUseCase(context, addWorkflowTableGroupOutput, input, {
    tableId: input.tableId,
  })
}

export const copilotCreateTableEnrichmentGroupPolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotCreateTableEnrichmentGroup(
  context: CopilotTableDelegationContext | undefined,
  input: CreateTableEnrichmentGroupInput
) {
  return executeCopilotTableUseCase(context, createTableEnrichmentGroup, input, {
    tableId: input.tableId,
  })
}

export const copilotCreateTableFromWorkspaceFilePolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotCreateTableFromWorkspaceFile(
  context: CopilotTableDelegationContext | undefined,
  input: CreateTableFromWorkspaceFileInput
) {
  return executeCopilotTableUseCase(context, createTableFromWorkspaceFile, input)
}

export const copilotImportWorkspaceFileIntoTablePolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotImportWorkspaceFileIntoTable(
  context: CopilotTableDelegationContext | undefined,
  input: ImportWorkspaceFileInput
) {
  return executeCopilotTableUseCase(context, importWorkspaceFileIntoTable, input, {
    tableId: input.tableId,
  })
}
