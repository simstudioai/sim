import { Database, Loader2, MinusCircle, PlusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { type KnowledgeBaseArgs } from '@/lib/copilot/tools/shared/schemas'
import { useCopilotStore } from '@/stores/panel/copilot/store'

/**
 * Client tool for knowledge base operations
 */
export class KnowledgeBaseClientTool extends BaseClientTool {
  static readonly id = 'knowledge_base'

  constructor(toolCallId: string) {
    super(toolCallId, KnowledgeBaseClientTool.id, KnowledgeBaseClientTool.metadata)
  }

  /**
   * Only show interrupt for create operation
   */
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const toolCallsById = useCopilotStore.getState().toolCallsById
    const toolCall = toolCallsById[this.toolCallId]
    const params = toolCall?.params as KnowledgeBaseArgs | undefined

    // Only require confirmation for create operation
    if (params?.operation === 'create') {
      const name = params?.args?.name || 'new knowledge base'
      return {
        accept: { text: `Create "${name}"`, icon: PlusCircle },
        reject: { text: 'Skip', icon: XCircle },
      }
    }

    // No interrupt for list, get, query - auto-execute
    return undefined
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Accessing knowledge base', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Accessing knowledge base', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Accessing knowledge base', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Accessed knowledge base', icon: Database },
      [ClientToolCallState.error]: { text: 'Failed to access knowledge base', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted knowledge base access', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped knowledge base access', icon: MinusCircle },
    },
    getDynamicText: (params: Record<string, any>, state: ClientToolCallState) => {
      const operation = params?.operation as string | undefined
      const name = params?.args?.name as string | undefined

      const opVerbs: Record<string, { active: string; past: string; pending?: string }> = {
        create: {
          active: 'Creating knowledge base',
          past: 'Created knowledge base',
          pending: name ? `Create knowledge base "${name}"?` : 'Create knowledge base?',
        },
        list: { active: 'Listing knowledge bases', past: 'Listed knowledge bases' },
        get: { active: 'Getting knowledge base', past: 'Retrieved knowledge base' },
        query: { active: 'Querying knowledge base', past: 'Queried knowledge base' },
      }
      const defaultVerb: { active: string; past: string; pending?: string } = {
        active: 'Accessing knowledge base',
        past: 'Accessed knowledge base',
      }
      const verb = operation ? opVerbs[operation] || defaultVerb : defaultVerb

      if (state === ClientToolCallState.success) {
        return verb.past
      }
      if (state === ClientToolCallState.pending && verb.pending) {
        return verb.pending
      }
      if (
        state === ClientToolCallState.generating ||
        state === ClientToolCallState.pending ||
        state === ClientToolCallState.executing
      ) {
        return verb.active
      }
      return undefined
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(): Promise<void> {
    await this.execute()
  }

  async execute(): Promise<void> {
    // Tool execution is handled server-side by the orchestrator.
    // Client tool classes are retained for UI display configuration only.
    this.setState(ClientToolCallState.success)
  }
}
