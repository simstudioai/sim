import { Database, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

/** Data type enum for the get_workflow_data tool */
export type WorkflowDataType = 'global_variables' | 'custom_tools' | 'mcp_tools' | 'files'

export class GetWorkflowDataClientTool extends BaseClientTool {
  static readonly id = 'get_workflow_data'

  constructor(toolCallId: string) {
    super(toolCallId, GetWorkflowDataClientTool.id, GetWorkflowDataClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching workflow data', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching workflow data', icon: Database },
      [ClientToolCallState.executing]: { text: 'Fetching workflow data', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted fetching data', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved workflow data', icon: Database },
      [ClientToolCallState.error]: { text: 'Failed to fetch data', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped fetching data', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const dataType = params?.data_type as WorkflowDataType | undefined
      if (!dataType) return undefined

      const typeLabels: Record<WorkflowDataType, string> = {
        global_variables: 'variables',
        custom_tools: 'custom tools',
        mcp_tools: 'MCP tools',
        files: 'files',
      }

      const label = typeLabels[dataType] || dataType

      switch (state) {
        case ClientToolCallState.success:
          return `Retrieved ${label}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
          return `Fetching ${label}`
        case ClientToolCallState.pending:
          return `Fetch ${label}?`
        case ClientToolCallState.error:
          return `Failed to fetch ${label}`
        case ClientToolCallState.aborted:
          return `Aborted fetching ${label}`
        case ClientToolCallState.rejected:
          return `Skipped fetching ${label}`
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
