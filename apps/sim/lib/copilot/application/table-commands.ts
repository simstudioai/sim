import type { CopilotTableDelegationContext } from '@/lib/copilot/auth/table-delegation'
import { resolveCopilotTablePrincipal } from '@/lib/copilot/auth/table-delegation'
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

export const copilotReplaceProjectedWireRowsPolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotReplaceProjectedWireRows(
  context: CopilotTableDelegationContext | undefined,
  input: ReplaceProjectedWireRowsInput
) {
  return replaceProjectedWireRows.execute({
    principal: resolveCopilotTablePrincipal(context, input.tableId),
    input,
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
  return createWorkflowTableGroup.execute({
    principal: resolveCopilotTablePrincipal(context, input.tableId),
    input,
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
  return updateWorkflowTableGroup.execute({
    principal: resolveCopilotTablePrincipal(context, input.tableId),
    input,
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
  return addWorkflowTableGroupOutput.execute({
    principal: resolveCopilotTablePrincipal(context, input.tableId),
    input,
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
  return createTableEnrichmentGroup.execute({
    principal: resolveCopilotTablePrincipal(context, input.tableId),
    input,
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
  return createTableFromWorkspaceFile.execute({
    principal: resolveCopilotTablePrincipal(context),
    input,
  })
}

export const copilotImportWorkspaceFileIntoTablePolicy = {
  rate: INHERITED_COPILOT_RATE_POLICY,
  cost: NO_DIRECT_PROVIDER_COST_POLICY,
} as const

export function executeCopilotImportWorkspaceFileIntoTable(
  context: CopilotTableDelegationContext | undefined,
  input: ImportWorkspaceFileInput
) {
  return importWorkspaceFileIntoTable.execute({
    principal: resolveCopilotTablePrincipal(context, input.tableId),
    input,
  })
}
