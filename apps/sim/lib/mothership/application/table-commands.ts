import { executeCopilotTableUseCase } from '@/lib/mothership/application/execute-table-use-case'
import type { CopilotTableDelegationContext } from '@/lib/mothership/auth/table-delegation'
import {
  type ReplaceProjectedWireRowsInput,
  replaceProjectedWireRows,
} from '@/lib/table/application/rows'

/**
 * Request-rate admission is inherited from the authenticated Copilot request, and
 * no paid provider is invoked, so only table quota and storage limits apply.
 */
export function executeCopilotReplaceProjectedWireRows(
  context: CopilotTableDelegationContext | undefined,
  input: ReplaceProjectedWireRowsInput
) {
  return executeCopilotTableUseCase(context, replaceProjectedWireRows, input, {
    tableId: input.tableId,
  })
}
