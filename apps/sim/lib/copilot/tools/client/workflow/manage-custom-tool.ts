import { Check, Loader2, Plus, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { getCustomTool } from '@/hooks/queries/custom-tools'

/**
 * Client tool for creating, editing, and deleting custom tools via the copilot.
 */
export class ManageCustomToolClientTool extends BaseClientTool {
  static readonly id = 'manage_custom_tool'

  constructor(toolCallId: string) {
    super(toolCallId, ManageCustomToolClientTool.id, ManageCustomToolClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Managing custom tool',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Manage custom tool?', icon: Plus },
      [ClientToolCallState.executing]: { text: 'Managing custom tool', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed custom tool', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to manage custom tool', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted managing custom tool',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped managing custom tool',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const operation = params?.operation as 'add' | 'edit' | 'delete' | 'list' | undefined

      if (!operation) return undefined

      let toolName = params?.schema?.function?.name
      if (!toolName && params?.toolId) {
        try {
          const tool = getCustomTool(params.toolId)
          toolName = tool?.schema?.function?.name
        } catch {
          // Ignore errors accessing cache
        }
      }

      const getActionText = (verb: 'present' | 'past' | 'gerund') => {
        switch (operation) {
          case 'add':
            return verb === 'present' ? 'Create' : verb === 'past' ? 'Created' : 'Creating'
          case 'edit':
            return verb === 'present' ? 'Edit' : verb === 'past' ? 'Edited' : 'Editing'
          case 'delete':
            return verb === 'present' ? 'Delete' : verb === 'past' ? 'Deleted' : 'Deleting'
          case 'list':
            return verb === 'present' ? 'List' : verb === 'past' ? 'Listed' : 'Listing'
          default:
            return verb === 'present' ? 'Manage' : verb === 'past' ? 'Managed' : 'Managing'
        }
      }

      // For add: only show tool name in past tense (success)
      // For edit/delete: always show tool name
      // For list: never show individual tool name, use plural
      const shouldShowToolName = (currentState: ClientToolCallState) => {
        if (operation === 'list') return false
        if (operation === 'add') {
          return currentState === ClientToolCallState.success
        }
        return true // edit and delete always show tool name
      }

      const nameText =
        operation === 'list'
          ? ' custom tools'
          : shouldShowToolName(state) && toolName
            ? ` ${toolName}`
            : ' custom tool'

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
