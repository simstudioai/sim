import { BookOpen, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface KnowledgeArgs {
  instruction: string
}

/**
 * Knowledge tool that spawns a subagent to manage knowledge bases.
 * This tool auto-executes and the actual work is done by the knowledge subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class KnowledgeClientTool extends BaseClientTool {
  static readonly id = 'knowledge'

  constructor(toolCallId: string) {
    super(toolCallId, KnowledgeClientTool.id, KnowledgeClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Managing knowledge', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Managing knowledge', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Managing knowledge', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed knowledge', icon: BookOpen },
      [ClientToolCallState.error]: { text: 'Failed to manage knowledge', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped knowledge', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted knowledge', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Managing knowledge',
        completedLabel: 'Knowledge managed',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the knowledge tool.
   * This just marks the tool as executing - the actual knowledge search work is done server-side
   * by the knowledge subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: KnowledgeArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(KnowledgeClientTool.id, KnowledgeClientTool.metadata.uiConfig!)
