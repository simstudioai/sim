import { Loader2, Check, XCircle } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

export class GetBestPracticesClientTool extends BaseClientTool {
  static readonly id = 'get_block_best_practices'

  constructor(toolCallId: string) {
    super(toolCallId, GetBestPracticesClientTool.id, GetBestPracticesClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Generating best practices', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Best practicing', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Practiced', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to practice', icon: XCircle },
    },
  }
}