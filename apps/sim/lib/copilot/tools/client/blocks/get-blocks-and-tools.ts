import { Blocks, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  ExecuteResponseSuccessSchema,
  GetBlocksAndToolsResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

export class GetBlocksAndToolsClientTool extends BaseClientTool {
  static readonly id = 'get_blocks_and_tools'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlocksAndToolsClientTool.id, GetBlocksAndToolsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Exploring available options', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Exploring available options', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Exploring available options', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Explored available options', icon: Blocks },
      [ClientToolCallState.error]: { text: 'Failed to explore options', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted exploring options', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped exploring options', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    const logger = createLogger('GetBlocksAndToolsClientTool')
    try {
      this.setState(ClientToolCallState.executing)

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

      await this.markToolComplete(200, 'Successfully retrieved blocks and tools', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
