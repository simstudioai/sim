import { Loader2, Settings2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

export class SetGlobalWorkflowVariablesClientTool extends BaseClientTool {
  static readonly id = 'set_global_workflow_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      SetGlobalWorkflowVariablesClientTool.id,
      SetGlobalWorkflowVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to set workflow variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Set workflow variables?', icon: Settings2 },
      [ClientToolCallState.executing]: { text: 'Setting workflow variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Updated workflow variables', icon: Settings2 },
      [ClientToolCallState.error]: { text: 'Failed to set workflow variables', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted setting variables', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped setting variables', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Apply', icon: Settings2 },
      reject: { text: 'Skip', icon: XCircle },
    },
    uiConfig: {
      interrupt: {
        accept: { text: 'Apply', icon: Settings2 },
        reject: { text: 'Skip', icon: XCircle },
        showAllowOnce: true,
        showAllowAlways: true,
      },
      paramsTable: {
        columns: [
          { key: 'name', label: 'Name', width: '40%', editable: true, mono: true },
          { key: 'value', label: 'Value', width: '60%', editable: true, mono: true },
        ],
        extractRows: (params) => {
          const operations = params.operations || []
          return operations.map((op: any, idx: number) => [
            String(idx),
            op.name || '',
            String(op.value ?? ''),
          ])
        },
      },
    },
    getDynamicText: (params, state) => {
      if (params?.operations && Array.isArray(params.operations)) {
        const varNames = params.operations
          .slice(0, 2)
          .map((op: any) => op.name)
          .filter(Boolean)

        if (varNames.length > 0) {
          const varList = varNames.join(', ')
          const more = params.operations.length > 2 ? '...' : ''
          const displayText = `${varList}${more}`

          switch (state) {
            case ClientToolCallState.success:
              return `Set ${displayText}`
            case ClientToolCallState.executing:
              return `Setting ${displayText}`
            case ClientToolCallState.generating:
              return `Preparing to set ${displayText}`
            case ClientToolCallState.pending:
              return `Set ${displayText}?`
            case ClientToolCallState.error:
              return `Failed to set ${displayText}`
            case ClientToolCallState.aborted:
              return `Aborted setting ${displayText}`
            case ClientToolCallState.rejected:
              return `Skipped setting ${displayText}`
          }
        }
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}

// Register UI config at module load
registerToolUIConfig(
  SetGlobalWorkflowVariablesClientTool.id,
  SetGlobalWorkflowVariablesClientTool.metadata.uiConfig!
)
