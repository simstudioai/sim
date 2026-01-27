import { createLogger } from '@sim/logger'
import { Database, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('GetWorkflowDataClientTool')

/** Data type enum for the get_workflow_data tool */
export type WorkflowDataType = 'global_variables' | 'custom_tools' | 'mcp_tools' | 'files'

interface GetWorkflowDataArgs {
  data_type: WorkflowDataType
}

export class GetWorkflowDataClientTool extends BaseClientTool {
  static readonly id = 'get_workflow_data'

  constructor(toolCallId: string) {
    super(toolCallId, GetWorkflowDataClientTool.id, GetWorkflowDataClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching workflow data', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching workflow data', icon: Database },
      [ClientToolCallState.executing]: { text: 'Fetching workflow data', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted fetching data', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved workflow data', icon: Database },
      [ClientToolCallState.error]: { text: 'Failed to fetch data', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped fetching data', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const dataType = params?.data_type as WorkflowDataType | undefined
      if (!dataType) return undefined

      const typeLabels: Record<WorkflowDataType, string> = {
        global_variables: 'variables',
        custom_tools: 'custom tools',
        mcp_tools: 'MCP tools',
        files: 'files',
      }

      const label = typeLabels[dataType] || dataType

      switch (state) {
        case ClientToolCallState.success:
          return `Retrieved ${label}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
          return `Fetching ${label}`
        case ClientToolCallState.pending:
          return `Fetch ${label}?`
        case ClientToolCallState.error:
          return `Failed to fetch ${label}`
        case ClientToolCallState.aborted:
          return `Aborted fetching ${label}`
        case ClientToolCallState.rejected:
          return `Skipped fetching ${label}`
      }
      return undefined
    },
  }

  async execute(args?: GetWorkflowDataArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      const dataType = args?.data_type
      if (!dataType) {
        await this.markToolComplete(400, 'Missing data_type parameter')
        this.setState(ClientToolCallState.error)
        return
      }

      const { activeWorkflowId, hydration } = useWorkflowRegistry.getState()
      const activeWorkspaceId = hydration.workspaceId

      switch (dataType) {
        case 'global_variables':
          await this.fetchGlobalVariables(activeWorkflowId)
          break
        case 'custom_tools':
          await this.fetchCustomTools(activeWorkspaceId)
          break
        case 'mcp_tools':
          await this.fetchMcpTools(activeWorkspaceId)
          break
        case 'files':
          await this.fetchFiles(activeWorkspaceId)
          break
        default:
          await this.markToolComplete(400, `Unknown data_type: ${dataType}`)
          this.setState(ClientToolCallState.error)
          return
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to fetch workflow data')
      this.setState(ClientToolCallState.error)
    }
  }

  /**
   * Fetch global workflow variables
   */
  private async fetchGlobalVariables(workflowId: string | null): Promise<void> {
    if (!workflowId) {
      await this.markToolComplete(400, 'No active workflow found')
      this.setState(ClientToolCallState.error)
      return
    }

    const res = await fetch(`/api/workflows/${workflowId}/variables`, { method: 'GET' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      await this.markToolComplete(res.status, text || 'Failed to fetch workflow variables')
      this.setState(ClientToolCallState.error)
      return
    }

    const json = await res.json()
    const varsRecord = (json?.data as Record<string, unknown>) || {}
    const variables = Object.values(varsRecord).map((v: unknown) => {
      const variable = v as { id?: string; name?: string; value?: unknown }
      return {
        id: String(variable?.id || ''),
        name: String(variable?.name || ''),
        value: variable?.value,
      }
    })

    logger.info('Fetched workflow variables', { count: variables.length })
    await this.markToolComplete(200, `Found ${variables.length} variable(s)`, { variables })
    this.setState(ClientToolCallState.success)
  }

  /**
   * Fetch custom tools for the workspace
   */
  private async fetchCustomTools(workspaceId: string | null): Promise<void> {
    if (!workspaceId) {
      await this.markToolComplete(400, 'No active workspace found')
      this.setState(ClientToolCallState.error)
      return
    }

    const res = await fetch(`/api/tools/custom?workspaceId=${workspaceId}`, { method: 'GET' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      await this.markToolComplete(res.status, text || 'Failed to fetch custom tools')
      this.setState(ClientToolCallState.error)
      return
    }

    const json = await res.json()
    const toolsData = (json?.data as unknown[]) || []
    const customTools = toolsData.map((tool: unknown) => {
      const t = tool as {
        id?: string
        title?: string
        schema?: { function?: { name?: string; description?: string; parameters?: unknown } }
        code?: string
      }
      return {
        id: String(t?.id || ''),
        title: String(t?.title || ''),
        functionName: String(t?.schema?.function?.name || ''),
        description: String(t?.schema?.function?.description || ''),
        parameters: t?.schema?.function?.parameters,
      }
    })

    logger.info('Fetched custom tools', { count: customTools.length })
    await this.markToolComplete(200, `Found ${customTools.length} custom tool(s)`, { customTools })
    this.setState(ClientToolCallState.success)
  }

  /**
   * Fetch MCP tools for the workspace
   */
  private async fetchMcpTools(workspaceId: string | null): Promise<void> {
    if (!workspaceId) {
      await this.markToolComplete(400, 'No active workspace found')
      this.setState(ClientToolCallState.error)
      return
    }

    const res = await fetch(`/api/mcp/tools/discover?workspaceId=${workspaceId}`, { method: 'GET' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      await this.markToolComplete(res.status, text || 'Failed to fetch MCP tools')
      this.setState(ClientToolCallState.error)
      return
    }

    const json = await res.json()
    const toolsData = (json?.data?.tools as unknown[]) || []
    const mcpTools = toolsData.map((tool: unknown) => {
      const t = tool as {
        name?: string
        serverId?: string
        serverName?: string
        description?: string
        inputSchema?: unknown
      }
      return {
        name: String(t?.name || ''),
        serverId: String(t?.serverId || ''),
        serverName: String(t?.serverName || ''),
        description: String(t?.description || ''),
        inputSchema: t?.inputSchema,
      }
    })

    logger.info('Fetched MCP tools', { count: mcpTools.length })
    await this.markToolComplete(200, `Found ${mcpTools.length} MCP tool(s)`, { mcpTools })
    this.setState(ClientToolCallState.success)
  }

  /**
   * Fetch workspace files metadata
   */
  private async fetchFiles(workspaceId: string | null): Promise<void> {
    if (!workspaceId) {
      await this.markToolComplete(400, 'No active workspace found')
      this.setState(ClientToolCallState.error)
      return
    }

    const res = await fetch(`/api/workspaces/${workspaceId}/files`, { method: 'GET' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      await this.markToolComplete(res.status, text || 'Failed to fetch files')
      this.setState(ClientToolCallState.error)
      return
    }

    const json = await res.json()
    const filesData = (json?.files as unknown[]) || []
    const files = filesData.map((file: unknown) => {
      const f = file as {
        id?: string
        name?: string
        key?: string
        path?: string
        size?: number
        type?: string
        uploadedAt?: string
      }
      return {
        id: String(f?.id || ''),
        name: String(f?.name || ''),
        key: String(f?.key || ''),
        path: String(f?.path || ''),
        size: Number(f?.size || 0),
        type: String(f?.type || ''),
        uploadedAt: String(f?.uploadedAt || ''),
      }
    })

    logger.info('Fetched workspace files', { count: files.length })
    await this.markToolComplete(200, `Found ${files.length} file(s)`, { files })
    this.setState(ClientToolCallState.success)
  }
}
