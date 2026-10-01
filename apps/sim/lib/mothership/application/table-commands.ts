import { executeCopilotTableUseCase } from '@/lib/mothership/application/execute-table-use-case'
import type { CopilotTableDelegationContext } from '@/lib/mothership/auth/table-delegation'
import {
  type ReplaceProjectedWireRowsInput,
  replaceProjectedWireRows,
} from '@/lib/table/application/rows'

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
  return executeCopilotTableUseCase(context, replaceProjectedWireRows, input, {
    tableId: input.tableId,
  })
}
