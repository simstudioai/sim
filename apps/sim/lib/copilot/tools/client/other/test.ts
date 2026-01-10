import { FlaskConical, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

interface TestArgs {
  instruction: string
}

/**
 * Test tool that spawns a subagent to run tests.
 * This tool auto-executes and the actual work is done by the test subagent.
 * The subagent's output is streamed as nested content under this tool call.
 */
export class TestClientTool extends BaseClientTool {
  static readonly id = 'test'

  constructor(toolCallId: string) {
    super(toolCallId, TestClientTool.id, TestClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Testing', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Testing', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Testing', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Tested', icon: FlaskConical },
      [ClientToolCallState.error]: { text: 'Failed to test', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped test', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted test', icon: XCircle },
    },
    uiConfig: {
      subagent: {
        streamingLabel: 'Testing',
        completedLabel: 'Tested',
        shouldCollapse: true,
        outputArtifacts: [],
      },
    },
  }

  /**
   * Execute the test tool.
   * This just marks the tool as executing - the actual test work is done server-side
   * by the test subagent, and its output is streamed as subagent events.
   */
  async execute(_args?: TestArgs): Promise<void> {
    this.setState(ClientToolCallState.executing)
  }
}

// Register UI config at module load
registerToolUIConfig(TestClientTool.id, TestClientTool.metadata.uiConfig!)
