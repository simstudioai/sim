import { List, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('GetGlobalWorkflowVariablesClientTool')

export class GetGlobalWorkflowVariablesClientTool extends BaseClientTool {
  static readonly id = 'get_global_workflow_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      GetGlobalWorkflowVariablesClientTool.id,
      GetGlobalWorkflowVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching workflow variables', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching workflow variables', icon: List },
      [ClientToolCallState.executing]: { text: 'Fetching workflow variables', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted fetching variables', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Workflow variables retrieved', icon: List },
      [ClientToolCallState.error]: { text: 'Failed to fetch variables', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped fetching variables', icon: XCircle },
    },
  }

  async execute(): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const { activeWorkflowId } = useWorkflowRegistry.getState()
      if (!activeWorkflowId) {
        await this.markToolComplete(400, 'No active workflow found')
        this.setState(ClientToolCallState.error)
        return
      }

      const res = await fetch(`/api/workflows/${activeWorkflowId}/variables`, { method: 'GET' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        await this.markToolComplete(res.status, text || 'Failed to fetch workflow variables')
        this.setState(ClientToolCallState.error)
        return
      }
      const json = await res.json()
      const varsRecord = (json?.data as Record<string, any>) || {}
      // Convert to name/value pairs for clarity
      const variables = Object.values(varsRecord).map((v: any) => ({
        name: String(v?.name || ''),
        value: (v as any)?.value,
      }))
      logger.info('Fetched workflow variables', { count: variables.length })
      await this.markToolComplete(200, `Found ${variables.length} variable(s)`, { variables })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to fetch workflow variables')
      this.setState(ClientToolCallState.error)
    }
  }
}
