import { FileText, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('GetWorkflowFromNameClientTool')

interface GetWorkflowFromNameArgs {
  workflow_name: string
}

export class GetWorkflowFromNameClientTool extends BaseClientTool {
  static readonly id = 'get_workflow_from_name'

  constructor(toolCallId: string) {
    super(toolCallId, GetWorkflowFromNameClientTool.id, GetWorkflowFromNameClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Retrieving workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Retrieving workflow', icon: FileText },
      [ClientToolCallState.executing]: { text: 'Retrieving workflow', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted retrieving workflow', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved workflow', icon: FileText },
      [ClientToolCallState.error]: { text: 'Failed to retrieve workflow', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped retrieving workflow', icon: XCircle },
    },
  }

  async execute(args?: GetWorkflowFromNameArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      const workflowName = args?.workflow_name?.trim()
      if (!workflowName) {
        await this.markToolComplete(400, 'workflow_name is required')
        this.setState(ClientToolCallState.error)
        return
      }

      // Try to find by name from registry first to get ID
      const registry = useWorkflowRegistry.getState()
      const match = Object.values((registry as any).workflows || {}).find(
        (w: any) =>
          String(w?.name || '')
            .trim()
            .toLowerCase() === workflowName.toLowerCase()
      ) as any

      if (!match?.id) {
        await this.markToolComplete(404, `Workflow not found: ${workflowName}`)
        this.setState(ClientToolCallState.error)
        return
      }

      // Fetch full workflow from API route (normalized tables)
      const res = await fetch(`/api/workflows/${encodeURIComponent(match.id)}`, { method: 'GET' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        await this.markToolComplete(res.status, text || 'Failed to fetch workflow by name')
        this.setState(ClientToolCallState.error)
        return
      }

      const json = await res.json()
      const wf = json?.data
      if (!wf?.state?.blocks) {
        await this.markToolComplete(422, 'Workflow state is empty or invalid')
        this.setState(ClientToolCallState.error)
        return
      }

      // Convert state to the same string format as get_user_workflow
      const workflowState = {
        blocks: wf.state.blocks || {},
        edges: wf.state.edges || [],
        loops: wf.state.loops || {},
        parallels: wf.state.parallels || {},
      }
      // Sanitize workflow state for copilot (remove UI-specific data)
      const sanitizedState = sanitizeForCopilot(workflowState)
      const userWorkflow = JSON.stringify(sanitizedState, null, 2)

      await this.markToolComplete(200, `Retrieved workflow ${workflowName}`, { userWorkflow })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to retrieve workflow by name')
      this.setState(ClientToolCallState.error)
    }
  }
}
