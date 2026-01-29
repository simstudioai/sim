import { db } from '@sim/db'
import { customTools, mcpServers as mcpServersTable, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { normalizeName } from '@/executor/constants'
import type { BaseServerTool } from '../base-tool'

const logger = createLogger('GetWorkflowDataServerTool')

export const GetWorkflowDataInput = z.object({
  workflowId: z.string().min(1),
  workspaceId: z.string().optional(),
  data_type: z.enum(['global_variables', 'custom_tools', 'mcp_tools', 'files']),
})

interface Variable {
  id: string
  name: string
  value?: unknown
  type?: string
}

export const getWorkflowDataServerTool: BaseServerTool<typeof GetWorkflowDataInput, unknown> = {
  name: 'get_workflow_data',

  async execute(args: unknown, context?: { userId: string }) {
    const parsed = GetWorkflowDataInput.parse(args)
    const { workflowId, data_type } = parsed

    logger.info('Getting workflow data', {
      workflowId,
      dataType: data_type,
    })

    // Get workspace ID from workflow
    const [wf] = await db
      .select({ workspaceId: workflow.workspaceId, variables: workflow.variables })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!wf?.workspaceId) {
      throw new Error('Workflow not found or has no workspace')
    }

    const workspaceId = wf.workspaceId

    switch (data_type) {
      case 'global_variables':
        return fetchGlobalVariables(wf.variables as Record<string, Variable> | null)
      case 'custom_tools':
        return await fetchCustomTools(workspaceId)
      case 'mcp_tools':
        return await fetchMcpTools(workspaceId)
      case 'files':
        // Files require workspace ID - we'd need to call an API or access storage
        // For now, return empty array as files are typically accessed via API
        return { files: [], message: 'File listing not yet implemented server-side' }
      default:
        throw new Error(`Unknown data type: ${data_type}`)
    }
  },
}

function fetchGlobalVariables(workflowVariables: Record<string, Variable> | null) {
  const variables: Array<{ id: string; name: string; value: unknown; tag: string }> = []

  if (workflowVariables && typeof workflowVariables === 'object') {
    for (const variable of Object.values(workflowVariables)) {
      if (
        typeof variable === 'object' &&
        variable !== null &&
        'name' in variable &&
        typeof variable.name === 'string' &&
        variable.name.trim() !== ''
      ) {
        variables.push({
          id: variable.id,
          name: variable.name,
          value: variable.value,
          tag: `variable.${normalizeName(variable.name)}`,
        })
      }
    }
  }

  logger.info('Fetched workflow variables', { count: variables.length })
  return { variables }
}

async function fetchCustomTools(workspaceId: string) {
  const tools = await db
    .select({
      id: customTools.id,
      title: customTools.title,
      schema: customTools.schema,
    })
    .from(customTools)
    .where(eq(customTools.workspaceId, workspaceId))

  const formattedTools = tools.map((tool) => {
    const schema = tool.schema as {
      function?: { name?: string; description?: string; parameters?: unknown }
    } | null

    return {
      id: tool.id,
      title: tool.title,
      functionName: schema?.function?.name || '',
      description: schema?.function?.description || '',
      parameters: schema?.function?.parameters,
    }
  })

  logger.info('Fetched custom tools', { count: formattedTools.length })
  return { customTools: formattedTools }
}

async function fetchMcpTools(workspaceId: string) {
  const servers = await db
    .select({
      id: mcpServersTable.id,
      name: mcpServersTable.name,
      url: mcpServersTable.url,
      enabled: mcpServersTable.enabled,
    })
    .from(mcpServersTable)
    .where(and(eq(mcpServersTable.workspaceId, workspaceId), eq(mcpServersTable.enabled, true)))

  // For MCP tools, we return the server list
  // Full tool discovery would require connecting to each server
  const mcpServers = servers.map((server) => ({
    serverId: server.id,
    serverName: server.name,
    url: server.url,
    enabled: server.enabled,
  }))

  logger.info('Fetched MCP servers', { count: mcpServers.length })
  return { mcpServers, message: 'MCP servers listed. Full tool discovery requires server connection.' }
}
