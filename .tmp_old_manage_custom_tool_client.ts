import { createLogger } from '@sim/logger'
import { Check, Loader2, Plus, X, XCircle } from 'lucide-react'
import { client } from '@/lib/auth/auth-client'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { getCustomTool } from '@/hooks/queries/custom-tools'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface CustomToolSchema {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

interface ManageCustomToolArgs {
  operation: 'add' | 'edit' | 'delete' | 'list'
  toolId?: string
  schema?: CustomToolSchema
  code?: string
}

const API_ENDPOINT = '/api/tools/custom'

async function checkCustomToolsPermission(): Promise<void> {
  const activeOrgResponse = await client.organization.getFullOrganization()
  const organizationId = activeOrgResponse.data?.id
  if (!organizationId) return

  const response = await fetch(`/api/permission-groups/user?organizationId=${organizationId}`)
  if (!response.ok) return

  const data = await response.json()
  if (data?.config?.disableCustomTools) {
    throw new Error('Custom tools are not allowed based on your permission group settings')
  }
}

/**
 * Client tool for creating, editing, and deleting custom tools via the copilot.
 */
export class ManageCustomToolClientTool extends BaseClientTool {
  static readonly id = 'manage_custom_tool'
  private currentArgs?: ManageCustomToolArgs

  constructor(toolCallId: string) {
    super(toolCallId, ManageCustomToolClientTool.id, ManageCustomToolClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Managing custom tool',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Manage custom tool?', icon: Plus },
      [ClientToolCallState.executing]: { text: 'Managing custom tool', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed custom tool', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to manage custom tool', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted managing custom tool',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped managing custom tool',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const operation = params?.operation as 'add' | 'edit' | 'delete' | 'list' | undefined

      if (!operation) return undefined

      let toolName = params?.schema?.function?.name
      if (!toolName && params?.toolId) {
        try {
          const tool = getCustomTool(params.toolId)
          toolName = tool?.schema?.function?.name
        } catch {
          // Ignore errors accessing cache
        }
      }

      const getActionText = (verb: 'present' | 'past' | 'gerund') => {
        switch (operation) {
          case 'add':
            return verb === 'present' ? 'Create' : verb === 'past' ? 'Created' : 'Creating'
          case 'edit':
            return verb === 'present' ? 'Edit' : verb === 'past' ? 'Edited' : 'Editing'
          case 'delete':
            return verb === 'present' ? 'Delete' : verb === 'past' ? 'Deleted' : 'Deleting'
          case 'list':
            return verb === 'present' ? 'List' : verb === 'past' ? 'Listed' : 'Listing'
          default:
            return verb === 'present' ? 'Manage' : verb === 'past' ? 'Managed' : 'Managing'
        }
      }

      // For add: only show tool name in past tense (success)
      // For edit/delete: always show tool name
      // For list: never show individual tool name, use plural
      const shouldShowToolName = (currentState: ClientToolCallState) => {
        if (operation === 'list') return false
        if (operation === 'add') {
          return currentState === ClientToolCallState.success
        }
        return true // edit and delete always show tool name
      }

      const nameText =
        operation === 'list'
          ? ' custom tools'
          : shouldShowToolName(state) && toolName
            ? ` ${toolName}`
            : ' custom tool'

      switch (state) {
        case ClientToolCallState.success:
          return `${getActionText('past')}${nameText}`
        case ClientToolCallState.executing:
          return `${getActionText('gerund')}${nameText}`
        case ClientToolCallState.generating:
          return `${getActionText('gerund')}${nameText}`
        case ClientToolCallState.pending:
          return `${getActionText('present')}${nameText}?`
        case ClientToolCallState.error:
          return `Failed to ${getActionText('present')?.toLowerCase()}${nameText}`
        case ClientToolCallState.aborted:
          return `Aborted ${getActionText('gerund')?.toLowerCase()}${nameText}`
        case ClientToolCallState.rejected:
          return `Skipped ${getActionText('gerund')?.toLowerCase()}${nameText}`
      }
      return undefined
    },
  }

  /**
   * Gets the tool call args from the copilot store (needed before execute() is called)
   */
  private getArgsFromStore(): ManageCustomToolArgs | undefined {
    try {
      const { toolCallsById } = useCopilotStore.getState()
      const toolCall = toolCallsById[this.toolCallId]
      return (toolCall as any)?.params as ManageCustomToolArgs | undefined
    } catch {
      return undefined
    }
  }

  /**
   * Override getInterruptDisplays to only show confirmation for edit and delete operations.
   * Add operations execute directly without confirmation.
   */
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const args = this.currentArgs || this.getArgsFromStore()
    const operation = args?.operation
    if (operation === 'edit' || operation === 'delete') {
      return this.metadata.interrupt
    }
    return undefined
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: ManageCustomToolArgs): Promise<void> {
    const logger = createLogger('ManageCustomToolClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      await this.executeOperation(args, logger)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to manage custom tool', {
        success: false,
        error: e?.message || 'Failed to manage custom tool',
      })
    }
  }

  async execute(args?: ManageCustomToolArgs): Promise<void> {
    this.currentArgs = args
    if (args?.operation === 'add' || args?.operation === 'list') {
      await this.handleAccept(args)
    }
  }

  /**
   * Executes the custom tool operation (add, edit, delete, or list)
   */
  private async executeOperation(
    args: ManageCustomToolArgs | undefined,
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    if (!args?.operation) {
      throw new Error('Operation is required')
    }

    await checkCustomToolsPermission()

    const { operation, toolId, schema, code } = args

    const { hydration } = useWorkflowRegistry.getState()
    const workspaceId = hydration.workspaceId
    if (!workspaceId) {
      throw new Error('No active workspace found')
    }

    logger.info(`Executing custom tool operation: ${operation}`, {
      operation,
      toolId,
      functionName: schema?.function?.name,
      workspaceId,
    })

    switch (operation) {
      case 'add':
        await this.addCustomTool({ schema, code, workspaceId }, logger)
        break
      case 'edit':
        await this.editCustomTool({ toolId, schema, code, workspaceId }, logger)
        break
      case 'delete':
        await this.deleteCustomTool({ toolId, workspaceId }, logger)
        break
      case 'list':
        await this.markToolComplete(200, 'Listed custom tools')
        break
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  /**
   * Creates a new custom tool
   */
  private async addCustomTool(
    params: {
      schema?: CustomToolSchema
      code?: string
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { schema, code, workspaceId } = params

    if (!schema) {
      throw new Error('Schema is required for adding a custom tool')
    }
    if (!code) {
      throw new Error('Code is required for adding a custom tool')
    }

    const functionName = schema.function.name

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: [{ title: functionName, schema, code }],
        workspaceId,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create custom tool')
    }

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('Invalid API response: missing tool data')
    }

    const createdTool = data.data[0]
    logger.info(`Created custom tool: ${functionName}`, { toolId: createdTool.id })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Created custom tool "${functionName}"`, {
      success: true,
      operation: 'add',
      toolId: createdTool.id,
      functionName,
    })
  }

  /**
   * Updates an existing custom tool
   */
  private async editCustomTool(
    params: {
      toolId?: string
      schema?: CustomToolSchema
      code?: string
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { toolId, schema, code, workspaceId } = params

    if (!toolId) {
      throw new Error('Tool ID is required for editing a custom tool')
    }

    if (!schema && !code) {
      throw new Error('At least one of schema or code must be provided for editing')
    }

    const existingResponse = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)
    const existingData = await existingResponse.json()

    if (!existingResponse.ok) {
      throw new Error(existingData.error || 'Failed to fetch existing tools')
    }

    const existingTool = existingData.data?.find((t: any) => t.id === toolId)
    if (!existingTool) {
      throw new Error(`Tool with ID ${toolId} not found`)
    }

    const mergedSchema = schema ?? existingTool.schema
    const updatedTool = {
      id: toolId,
      title: mergedSchema.function.name,
      schema: mergedSchema,
      code: code ?? existingTool.code,
    }

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: [updatedTool],
        workspaceId,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update custom tool')
    }

    const functionName = updatedTool.schema.function.name
    logger.info(`Updated custom tool: ${functionName}`, { toolId })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Updated custom tool "${functionName}"`, {
      success: true,
      operation: 'edit',
      toolId,
      functionName,
    })
  }

  /**
   * Deletes a custom tool
   */
  private async deleteCustomTool(
    params: {
      toolId?: string
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { toolId, workspaceId } = params

    if (!toolId) {
      throw new Error('Tool ID is required for deleting a custom tool')
    }

    const url = `${API_ENDPOINT}?id=${toolId}&workspaceId=${workspaceId}`
    const response = await fetch(url, {
      method: 'DELETE',
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete custom tool')
    }

    logger.info(`Deleted custom tool: ${toolId}`)

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Deleted custom tool`, {
      success: true,
      operation: 'delete',
      toolId,
    })
  }
}
