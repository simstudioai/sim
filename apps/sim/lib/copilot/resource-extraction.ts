import type { MothershipResource, MothershipResourceType } from '@/lib/copilot/resource-types'

type ChatResource = MothershipResource
type ResourceType = MothershipResourceType

/**
 * Defines how each tool's result is surfaced in the resource panel:
 * - `dedicated` — opens its own resource tab (table, file, workflow, knowledgebase)
 * - `deferred`  — may open a dedicated tab; falls back to the Results tab if no resource is produced
 * - `excluded`  — hidden from the resource panel (internal tools, management, subagent wrappers)
 *
 * Any tool not listed here appears in the generic Results tab by default.
 */
const TOOL_PANEL_BEHAVIOR: Record<string, 'dedicated' | 'deferred' | 'excluded'> = {
  // Dedicated resource tab openers
  user_table: 'dedicated',
  workspace_file: 'dedicated',
  download_to_workspace_file: 'dedicated',
  create_workflow: 'dedicated',
  edit_workflow: 'dedicated',
  knowledge_base: 'dedicated',
  knowledge: 'dedicated',
  generate_visualization: 'dedicated',
  generate_image: 'dedicated',
  // Deferred: may produce a dedicated resource; falls back to Results tab otherwise
  function_execute: 'deferred',
  // Excluded: saves files without opening a resource tab
  materialize_file: 'excluded',
  // Excluded: internal / invisible
  user_memory: 'excluded',
  context_write: 'excluded',
  context_compaction: 'excluded',
  // Excluded: workflow and folder management
  rename_workflow: 'excluded',
  move_workflow: 'excluded',
  delete_workflow: 'excluded',
  create_folder: 'excluded',
  delete_folder: 'excluded',
  move_folder: 'excluded',
  list_folders: 'excluded',
  list_user_workspaces: 'excluded',
  open_resource: 'excluded',
  // Excluded: settings and credential management
  set_environment_variables: 'excluded',
  set_global_workflow_variables: 'excluded',
  manage_mcp_tool: 'excluded',
  manage_skill: 'excluded',
  manage_credential: 'excluded',
  manage_custom_tool: 'excluded',
  oauth_get_auth_link: 'excluded',
  oauth_request_access: 'excluded',
  update_workspace_mcp_server: 'excluded',
  delete_workspace_mcp_server: 'excluded',
  create_workspace_mcp_server: 'excluded',
  list_workspace_mcp_servers: 'excluded',
  // Excluded: subagent wrappers — inner tools fire as individual events
  build: 'excluded',
  run: 'excluded',
  deploy: 'excluded',
  auth: 'excluded',
  table: 'excluded',
  job: 'excluded',
  agent: 'excluded',
  custom_tool: 'excluded',
  research: 'excluded',
  plan: 'excluded',
  debug: 'excluded',
  edit: 'excluded',
  fast_edit: 'excluded',
}

/**
 * Returns true for resources that are client-only and must never be persisted to the server.
 * This covers the generic Results tab and the in-flight streaming-file preview.
 */
export function isEphemeralResource(resource: { id: string; type: string }): boolean {
  return resource.type === 'generic' || resource.id === 'streaming-file'
}

/** Returns true for tools that open a dedicated resource tab or may fall back to the Results tab. */
export function isResourceToolName(toolName: string): boolean {
  const b = TOOL_PANEL_BEHAVIOR[toolName]
  return b === 'dedicated' || b === 'deferred'
}

/** Returns true if the tool's result should appear in the Results tab at call time. */
export function shouldOpenGenericResource(toolName: string): boolean {
  return !(toolName in TOOL_PANEL_BEHAVIOR)
}

/** Returns true for tools that may fall back to the Results tab at completion time. */
export function isDeferredResourceTool(toolName: string): boolean {
  return TOOL_PANEL_BEHAVIOR[toolName] === 'deferred'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getOperation(params: Record<string, unknown> | undefined): string | undefined {
  const args = asRecord(params?.args)
  return (args.operation ?? params?.operation) as string | undefined
}

const READ_ONLY_TABLE_OPS = new Set(['get', 'get_schema', 'get_row', 'query_rows'])
const READ_ONLY_KB_OPS = new Set(['get', 'query', 'list_tags', 'get_tag_usage'])
const READ_ONLY_KNOWLEDGE_ACTIONS = new Set(['listed', 'queried'])

/**
 * Extracts resource descriptors from a tool execution result.
 * Returns one or more resources for tools that create/modify workspace entities.
 * Read-only operations are excluded to avoid unnecessary cache invalidation.
 */
export function extractResourcesFromToolResult(
  toolName: string,
  params: Record<string, unknown> | undefined,
  output: unknown
): ChatResource[] {
  if (!isResourceToolName(toolName)) return []

  const result = asRecord(output)
  const data = asRecord(result.data)

  switch (toolName) {
    case 'user_table': {
      if (READ_ONLY_TABLE_OPS.has(getOperation(params) ?? '')) return []

      if (result.tableId) {
        return [
          {
            type: 'table',
            id: result.tableId as string,
            title: (result.tableName as string) || 'Table',
          },
        ]
      }
      if (result.fileId) {
        return [
          {
            type: 'file',
            id: result.fileId as string,
            title: (result.fileName as string) || 'File',
          },
        ]
      }
      const table = asRecord(data.table)
      if (table.id) {
        return [{ type: 'table', id: table.id as string, title: (table.name as string) || 'Table' }]
      }
      const args = asRecord(params?.args)
      const tableId =
        (data.tableId as string) ?? (args.tableId as string) ?? (params?.tableId as string)
      if (tableId) {
        return [
          { type: 'table', id: tableId as string, title: (data.tableName as string) || 'Table' },
        ]
      }
      return []
    }

    case 'workspace_file': {
      const file = asRecord(data.file)
      if (file.id) {
        return [{ type: 'file', id: file.id as string, title: (file.name as string) || 'File' }]
      }
      const fileId = (data.fileId as string) ?? (data.id as string)
      if (fileId) {
        const fileName = (data.fileName as string) || (data.name as string) || 'File'
        return [{ type: 'file', id: fileId, title: fileName }]
      }
      return []
    }

    case 'function_execute': {
      if (result.tableId) {
        return [
          {
            type: 'table',
            id: result.tableId as string,
            title: (result.tableName as string) || 'Table',
          },
        ]
      }
      if (result.fileId) {
        return [
          {
            type: 'file',
            id: result.fileId as string,
            title: (result.fileName as string) || 'File',
          },
        ]
      }
      return []
    }

    case 'download_to_workspace_file':
    case 'generate_visualization':
    case 'generate_image': {
      if (result.fileId) {
        return [
          {
            type: 'file',
            id: result.fileId as string,
            title: (result.fileName as string) || 'Generated File',
          },
        ]
      }
      return []
    }

    case 'create_workflow':
    case 'edit_workflow': {
      const workflowId =
        (result.workflowId as string) ??
        (data.workflowId as string) ??
        (params?.workflowId as string)
      if (workflowId) {
        const workflowName =
          (result.workflowName as string) ??
          (data.workflowName as string) ??
          (params?.workflowName as string) ??
          'Workflow'
        return [{ type: 'workflow', id: workflowId, title: workflowName }]
      }
      return []
    }

    case 'knowledge_base': {
      if (READ_ONLY_KB_OPS.has(getOperation(params) ?? '')) return []

      const args = asRecord(params?.args)
      const kbId =
        (args.knowledgeBaseId as string) ??
        (params?.knowledgeBaseId as string) ??
        (result.knowledgeBaseId as string) ??
        (data.knowledgeBaseId as string) ??
        (data.id as string)
      if (kbId) {
        const kbName =
          (data.name as string) ?? (result.knowledgeBaseName as string) ?? 'Knowledge Base'
        return [{ type: 'knowledgebase', id: kbId, title: kbName }]
      }
      return []
    }

    case 'knowledge': {
      const action = data.action as string | undefined
      if (READ_ONLY_KNOWLEDGE_ACTIONS.has(action ?? '')) return []

      const kbArray = data.knowledge_bases as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(kbArray)) return []
      const resources: ChatResource[] = []
      for (const kb of kbArray) {
        const id = kb.id as string | undefined
        if (id) {
          resources.push({
            type: 'knowledgebase',
            id,
            title: (kb.name as string) || 'Knowledge Base',
          })
        }
      }
      return resources
    }

    default:
      return []
  }
}

const DELETE_CAPABLE_TOOL_RESOURCE_TYPE: Record<string, ResourceType> = {
  delete_workflow: 'workflow',
  workspace_file: 'file',
  user_table: 'table',
  knowledge_base: 'knowledgebase',
}

export function hasDeleteCapability(toolName: string): boolean {
  return toolName in DELETE_CAPABLE_TOOL_RESOURCE_TYPE
}

/**
 * Extracts resource descriptors from a tool execution result when the tool
 * performed a deletion. Returns one or more deleted resources for tools that
 * destroy workspace entities.
 */
export function extractDeletedResourcesFromToolResult(
  toolName: string,
  params: Record<string, unknown> | undefined,
  output: unknown
): ChatResource[] {
  const resourceType = DELETE_CAPABLE_TOOL_RESOURCE_TYPE[toolName]
  if (!resourceType) return []

  const result = asRecord(output)
  const data = asRecord(result.data)
  const args = asRecord(params?.args)
  const operation = (args.operation ?? params?.operation) as string | undefined

  switch (toolName) {
    case 'delete_workflow': {
      const workflowId = (result.workflowId as string) ?? (params?.workflowId as string)
      if (workflowId && result.deleted) {
        return [
          { type: resourceType, id: workflowId, title: (result.name as string) || 'Workflow' },
        ]
      }
      return []
    }

    case 'workspace_file': {
      if (operation !== 'delete') return []
      const fileId = (data.id as string) ?? (args.fileId as string)
      if (fileId) {
        return [{ type: resourceType, id: fileId, title: (data.name as string) || 'File' }]
      }
      return []
    }

    case 'user_table': {
      if (operation !== 'delete') return []
      const tableId = (args.tableId as string) ?? (params?.tableId as string)
      if (tableId) {
        return [{ type: resourceType, id: tableId, title: 'Table' }]
      }
      return []
    }

    case 'knowledge_base': {
      if (operation !== 'delete') return []
      const kbId = (data.id as string) ?? (args.knowledgeBaseId as string)
      if (kbId) {
        return [{ type: resourceType, id: kbId, title: (data.name as string) || 'Knowledge Base' }]
      }
      return []
    }

    default:
      return []
  }
}
