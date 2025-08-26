import { FolderOpen, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface ListGDriveFilesArgs {
  userId?: string
  workflowId?: string
  search_query?: string
  searchQuery?: string
  num_results?: number
}

export class ListGDriveFilesClientTool extends BaseClientTool {
  static readonly id = 'list_gdrive_files'

  constructor(toolCallId: string) {
    super(toolCallId, ListGDriveFilesClientTool.id, ListGDriveFilesClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Listing GDrive files', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Listed GDrive files', icon: FolderOpen },
      [ClientToolCallState.error]: { text: 'Failed to list GDrive files', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped listing GDrive files', icon: MinusCircle },
    },
  }

  async execute(args?: ListGDriveFilesArgs): Promise<void> {
    const logger = createLogger('ListGDriveFilesClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      // Ensure server can resolve userId via workflowId if userId not provided
      const payload: ListGDriveFilesArgs = { ...(args || {}) }
      if (!payload.userId && !payload.workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) payload.workflowId = activeWorkflowId
      }

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'list_gdrive_files', payload }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Listed Google Drive files', parsed.result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to list Google Drive files')
    }
  }
}
