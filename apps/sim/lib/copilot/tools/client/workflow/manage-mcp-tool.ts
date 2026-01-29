import { Check, Loader2, Server, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

/**
 * Client tool for creating, editing, and deleting MCP tool servers via the copilot.
 */
export class ManageMcpToolClientTool extends BaseClientTool {
  static readonly id = 'manage_mcp_tool'

  constructor(toolCallId: string) {
    super(toolCallId, ManageMcpToolClientTool.id, ManageMcpToolClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Managing MCP tool',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Manage MCP tool?', icon: Server },
      [ClientToolCallState.executing]: { text: 'Managing MCP tool', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed MCP tool', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to manage MCP tool', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted managing MCP tool',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped managing MCP tool',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const operation = params?.operation as 'add' | 'edit' | 'delete' | undefined

      if (!operation) return undefined

      const serverName = params?.config?.name || params?.serverName

      const getActionText = (verb: 'present' | 'past' | 'gerund') => {
        switch (operation) {
          case 'add':
            return verb === 'present' ? 'Add' : verb === 'past' ? 'Added' : 'Adding'
          case 'edit':
            return verb === 'present' ? 'Edit' : verb === 'past' ? 'Edited' : 'Editing'
          case 'delete':
            return verb === 'present' ? 'Delete' : verb === 'past' ? 'Deleted' : 'Deleting'
        }
      }

      const shouldShowServerName = (currentState: ClientToolCallState) => {
        if (operation === 'add') {
          return currentState === ClientToolCallState.success
        }
        return true
      }

      const nameText = shouldShowServerName(state) && serverName ? ` ${serverName}` : ' MCP tool'

      switch (state) {
        case ClientToolCallState.success:
          return `${getActionText('past')}${nameText}`
        case ClientToolCallState.executing:
          return `${getActionText('gerund')}${nameText}`
        case ClientToolCallState.generating:
          return `${getActionText('gerund')}${nameText}`
        case ClientToolCallState.pending:
          return `${getActionText('present')}${nameText}?`
        case ClientToolCallState.error:
          return `Failed to ${getActionText('present')?.toLowerCase()}${nameText}`
        case ClientToolCallState.aborted:
          return `Aborted ${getActionText('gerund')?.toLowerCase()}${nameText}`
        case ClientToolCallState.rejected:
          return `Skipped ${getActionText('gerund')?.toLowerCase()}${nameText}`
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only for rendering tool call cards
  // Interrupts (edit/delete operations) are auto-executed in headless mode
}
