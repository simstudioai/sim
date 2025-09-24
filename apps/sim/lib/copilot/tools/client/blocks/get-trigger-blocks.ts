import { ListFilter, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  ExecuteResponseSuccessSchema,
  GetTriggerBlocksResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

export class GetTriggerBlocksClientTool extends BaseClientTool {
  static readonly id = 'get_trigger_blocks'

  constructor(toolCallId: string) {
    super(toolCallId, GetTriggerBlocksClientTool.id, GetTriggerBlocksClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Finding trigger blocks', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Found trigger blocks', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to find trigger blocks', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted finding trigger blocks', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped finding trigger blocks', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    const logger = createLogger('GetTriggerBlocksClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'get_trigger_blocks', payload: {} }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        try {
          const errorJson = JSON.parse(errorText)
          throw new Error(errorJson.error || errorText || `Server error (${res.status})`)
        } catch {
          throw new Error(errorText || `Server error (${res.status})`)
        }
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = GetTriggerBlocksResult.parse(parsed.result)

      await this.markToolComplete(200, 'Successfully retrieved trigger blocks', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
