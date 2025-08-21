import { Loader2, Blocks } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot-new/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/copilot/store'
import { z } from 'zod'
import { ExecuteResponseSuccessSchema, GetBlocksAndToolsResult } from '@/lib/copilot-new/tools/server/router'

export class GetBlocksAndToolsClientTool extends BaseClientTool {
  static readonly id = 'get_blocks_and_tools'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlocksAndToolsClientTool.id, GetBlocksAndToolsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to explore options', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Explore available options?', icon: Blocks },
      [ClientToolCallState.executing]: { text: 'Exploring available options', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Explored available options', icon: Blocks },
      [ClientToolCallState.error]: { text: 'Failed to explore options', icon: Blocks },
    },
    interrupt: undefined,
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

  async execute(): Promise<void> {
    const logger = createLogger('GetBlocksAndToolsClientTool')
    try {
      this.updateStoreToolCallState('executing')

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'get_blocks_and_tools', payload: {} }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(errorText || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = GetBlocksAndToolsResult.parse(parsed.result)

      // Mark tool as successful with full payload
      await this.markToolComplete(
        200,
        { blocksCount: result.blocks.length, toolsCount: result.tools.length },
        result
      )
      this.updateStoreToolCallState('success')
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.updateStoreToolCallState('errored')
    }
  }
} 