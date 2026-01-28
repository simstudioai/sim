import { createLogger } from '@sim/logger'
import { Database, Loader2, MinusCircle, PlusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  ExecuteResponseSuccessSchema,
  type KnowledgeBaseArgs,
} from '@/lib/copilot/tools/shared/schemas'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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

  async handleAccept(args?: KnowledgeBaseArgs): Promise<void> {
    await this.execute(args)
  }

  async execute(args?: KnowledgeBaseArgs): Promise<void> {
    const logger = createLogger('KnowledgeBaseClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      // Get the workspace ID from the workflow registry hydration state
      const { hydration } = useWorkflowRegistry.getState()
      const workspaceId = hydration.workspaceId

      // Build payload with workspace ID included in args
      const payload: KnowledgeBaseArgs = {
        ...(args || { operation: 'list' }),
        args: {
          ...(args?.args || {}),
          workspaceId: workspaceId || undefined,
        },
      }

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'knowledge_base', payload }),
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }

      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Knowledge base operation completed', parsed.result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to access knowledge base')
    }
  }
}
