import { isRecordLike } from '@sim/utils/object'
import type { QueryKey } from '@tanstack/react-query'
import type { ResourceAddress } from '@/lib/mothership/generated/resources'
import {
  blockDisplayName,
  cliFirstPositional,
  getToolDisplayTitle,
} from '@/lib/mothership/tools/tool-display'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { getBlock } from '@/blocks/registry'
import { mcpKeys } from '@/hooks/queries/mcp'
import { skillsKeys } from '@/hooks/queries/skills'
import { customToolsKeys } from '@/hooks/queries/utils/custom-tool-keys'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'
import { workspaceFileFolderKeys } from '@/hooks/queries/workspace-file-folders'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

export interface ToolResourceContext {
  workspaceId?: string
  resources?: readonly ResourceAddress[]
}

type NamedResource = ResourceAddress['type'] | 'skill' | 'customtool' | 'mcpserver' | 'workspace'

/** Use the chat workspace's existing inventories; naming never fetches a resource. */
function inventoryKeys(type: NamedResource, workspaceId: string): readonly QueryKey[] {
  switch (type) {
    case 'workflow':
      return [workflowKeys.list(workspaceId), workflowKeys.list(workspaceId, 'archived')]
    case 'table':
      return [tableKeys.list(workspaceId), tableKeys.list(workspaceId, 'archived')]
    case 'knowledgebase':
      return [knowledgeKeys.list(workspaceId), knowledgeKeys.list(workspaceId, 'archived')]
    case 'file':
      return [
        workspaceFilesKeys.list(workspaceId),
        workspaceFilesKeys.list(workspaceId, 'archived'),
      ]
    case 'filefolder':
      return [workspaceFileFolderKeys.list(workspaceId)]
    case 'folder':
      return (['workflow', 'table', 'knowledge_base'] as const).map((kind) =>
        folderKeys.list(workspaceId, 'active', kind)
      )
    case 'skill':
      return [skillsKeys.list(workspaceId)]
    case 'customtool':
      return [customToolsKeys.list(workspaceId)]
    case 'mcpserver':
      return [mcpKeys.serversList(workspaceId)]
    case 'workspace':
      return [workspaceKeys.list()]
    default:
      return []
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Inventory wrappers only: do not search resource contents for a coincidental id or name. */
function inventoryRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (!isRecordLike(data)) return []
  for (const key of ['tables', 'knowledgeBases', 'workspaces', 'data']) {
    if (Array.isArray(data[key])) return data[key]
  }
  return []
}

export function resolveResourceDisplayName(
  type: NamedResource,
  id: unknown,
  context: ToolResourceContext
): string | undefined {
  const resourceId = stringValue(id)
  if (!resourceId) return undefined
  const resource = context.resources?.find((item) => item.type === type && item.id === resourceId)
  const title = stringValue(resource?.title)
  const fallback = title && title !== resourceId ? title : undefined
  if (!context.workspaceId) return fallback
  for (const key of inventoryKeys(type, context.workspaceId)) {
    for (const row of inventoryRows(getQueryClient().getQueryData(key))) {
      if (!isRecordLike(row) || row.id !== resourceId) continue
      const name = stringValue(row.name) ?? stringValue(row.title)
      if (name) return name
    }
  }
  return fallback
}

/** Only successful inventory writes should refresh labels, never chat or tool-stream writes. */
export function isResourceNameQuery(key: QueryKey, workspaceId?: string): boolean {
  if (!workspaceId) return false
  if (key[0] === workspaceKeys.all[0]) return key[1] === 'list'
  return (
    [
      workflowKeys.all[0],
      tableKeys.all[0],
      knowledgeKeys.all[0],
      workspaceFilesKeys.all[0],
      workspaceFileFolderKeys.all[0],
      folderKeys.all[0],
      skillsKeys.all[0],
      customToolsKeys.all[0],
      mcpKeys.all[0],
    ].some((root) => root === key[0]) &&
    (key[1] === 'list' || key[1] === 'servers') &&
    key.includes(workspaceId)
  )
}

const CLI_RESOURCE_DOMAINS = {
  workflows: { type: 'workflow', noun: 'workflow' },
  tables: { type: 'table', noun: 'table' },
  files: { type: 'file', noun: 'file' },
  knowledge: { type: 'knowledgebase', noun: 'knowledge base' },
  skills: { type: 'skill', noun: 'skill' },
  custom_tools: { type: 'customtool', noun: 'custom tool' },
  mcp_servers: { type: 'mcpserver', noun: 'MCP server' },
  workspaces: { type: 'workspace', noun: 'workspace' },
} as const

/** Same enrichment for streaming snapshots and replayed rows, independent of the editor tab. */
export function resolveNamedCliToolDisplayTitle(
  name: string,
  args: Record<string, unknown> | undefined,
  context: ToolResourceContext
): string | undefined {
  const target = cliFirstPositional(name, args)
  if (!target) return undefined
  if (name === 'cli_blocks_get' || name === 'cli_blocks_tips') {
    const block = getBlock(target)
    if (!block) return undefined
    const base = getToolDisplayTitle(name, args)
    return base.replace(blockDisplayName(target), () => block.name)
  }
  for (const [domain, resource] of Object.entries(CLI_RESOURCE_DOMAINS)) {
    if (!name.startsWith(`cli_${domain}_`)) continue
    const folder = name.startsWith(`cli_${domain}_folders_`)
    const type = folder ? (domain === 'files' ? 'filefolder' : 'folder') : resource.type
    const resolvedName = resolveResourceDisplayName(type, target, context)
    if (!resolvedName) return undefined
    const base = getToolDisplayTitle(name, args)
    const noun = folder ? `${resource.noun} folder` : resource.noun
    const pattern = new RegExp(`\\b${noun}\\b`)
    return pattern.test(base)
      ? base.replace(pattern, () => resolvedName)
      : `${base}: ${resolvedName}`
  }
  return undefined
}
