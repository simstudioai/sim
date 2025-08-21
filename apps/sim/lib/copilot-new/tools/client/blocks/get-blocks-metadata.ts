import { Loader2, Info } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot-new/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/copilot/store'
import { ExecuteResponseSuccessSchema, GetBlocksMetadataInput, GetBlocksMetadataResult } from '@/lib/copilot-new/tools/shared/schemas'

interface GetBlocksMetadataArgs {
  blockIds: string[]
}

export class GetBlocksMetadataClientTool extends BaseClientTool {
  static readonly id = 'get_blocks_metadata'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlocksMetadataClientTool.id, GetBlocksMetadataClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to get block metadata', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Retrieving block metadata', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved block metadata', icon: Info },
      [ClientToolCallState.error]: { text: 'Failed to retrieve block metadata', icon: Info },
    },
  }

  private updateStoreToolCallState(next: 'executing' | 'success' | 'errored') {
    const { messages } = useCopilotStore.getState()
    const updated = messages.map((msg) => {
      const updatedToolCalls = msg.toolCalls?.map((tc) =>
        tc.id === this.toolCallId ? { ...tc, state: next } : tc
      )
      const updatedBlocks = msg.contentBlocks?.map((b: any) =>
        b.type === 'tool_call' && b.toolCall?.id === this.toolCallId
          ? { ...b, toolCall: { ...b.toolCall, state: next } }
          : b
      )
      return { ...msg, toolCalls: updatedToolCalls, contentBlocks: updatedBlocks }
    })
    useCopilotStore.setState({ messages: updated })
  }

  async execute(args?: GetBlocksMetadataArgs): Promise<void> {
    const logger = createLogger('GetBlocksMetadataClientTool')
    try {
      this.updateStoreToolCallState('executing')

      const { blockIds } = GetBlocksMetadataInput.parse(args || {})

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'get_blocks_metadata', payload: { blockIds } }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(errorText || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = GetBlocksMetadataResult.parse(parsed.result)

      await this.markToolComplete(200, { retrieved: Object.keys(result.metadata).length }, result)
      this.updateStoreToolCallState('success')
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.updateStoreToolCallState('errored')
    }
  }
} 