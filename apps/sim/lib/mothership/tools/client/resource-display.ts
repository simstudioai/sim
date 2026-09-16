import { isRecordLike } from '@sim/utils/object'
import type { QueryKey } from '@tanstack/react-query'
import type { ResourceAddress } from '@/lib/mothership/generated/resources'
import {
  blockDisplayName,
  cliFirstPositional,
  cliFlagValue,
  cliFlagValues,
  getToolDisplayTitle,
} from '@/lib/mothership/tools/tool-display'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { getBlock } from '@/blocks/registry'
import { skillsKeys } from '@/hooks/queries/skills'
import { customToolsKeys } from '@/hooks/queries/utils/custom-tool-keys'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { mcpKeys } from '@/hooks/queries/utils/mcp-keys'
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

/** Use the addressed workspace's existing inventories; naming never fetches a resource. */
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
      return getQueryClient()
        .getQueryCache()
        .findAll({ queryKey: workspaceKeys.all })
        .filter((query) => query.queryKey[1] === 'list' || query.queryKey[1] === 'adminList')
        .map((query) => query.queryKey)
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
  const resource = context.resources?.find(
    (item) =>
      item.type === type &&
      item.id === resourceId &&
      (!context.workspaceId || !item.workspaceId || item.workspaceId === context.workspaceId)
  )
  const title = stringValue(resource?.title)
  const fallback = title && title !== resourceId ? title : undefined
  const workspaceId = context.workspaceId ?? resource?.workspaceId
  if (!workspaceId && type !== 'workspace') return fallback
  for (const key of inventoryKeys(type, workspaceId ?? '')) {
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
  if (key[0] === workspaceKeys.all[0]) return key[1] === 'list' || key[1] === 'adminList'
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
    (!workspaceId || key.includes(workspaceId))
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
  if (!name.startsWith('cli_')) return undefined
  const target = cliFirstPositional(name, args)
  const domain = Object.entries(CLI_RESOURCE_DOMAINS).find(([key]) =>
    name.startsWith(`cli_${key}_`)
  )
  const resource = domain?.[1]
  const folder = domain && name.startsWith(`cli_${domain[0]}_folders_`)
  const type = folder ? (domain[0] === 'files' ? 'filefolder' : 'folder') : resource?.type
  const workflowIds = cliFlagValues(args, '--workflow')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  const request = isRecordLike(args?.request) ? args.request : undefined
  const explicitWorkspace =
    stringValue(request?.workspaceId) ??
    cliFlagValue(args, '--workspace') ??
    cliFlagValue(args, '-w')
  const addressed = context.resources?.find(
    (item) =>
      ((item.type === type && item.id === target) ||
        (item.type === 'workflow' && workflowIds.includes(item.id)) ||
        (name.startsWith('cli_logs_') && item.type === 'log' && item.id === target)) &&
      (!explicitWorkspace || item.workspaceId === explicitWorkspace)
  )
  const workspaceId = explicitWorkspace ?? addressed?.workspaceId ?? context.workspaceId
  const scoped = { ...context, workspaceId }
  const workspaceName =
    workspaceId && workspaceId !== context.workspaceId
      ? (resolveResourceDisplayName('workspace', workspaceId, scoped) ??
        context.resources?.find((item) => item.workspaceId === workspaceId && item.workspaceName)
          ?.workspaceName)
      : undefined
  const inWorkspace = (title: string): string =>
    workspaceName ? `${title} in ${workspaceName}` : title
  const base = getToolDisplayTitle(name, args)
  if (name === 'cli_blocks_get' || name === 'cli_blocks_tips') {
    const block = target ? getBlock(target) : undefined
    return block && target ? base.replace(blockDisplayName(target), () => block.name) : undefined
  }
  if (name.startsWith('cli_logs_')) {
    const names = workflowIds.map((id) => resolveResourceDisplayName('workflow', id, scoped))
    const workflow =
      names.length && names.every(Boolean)
        ? names.join(', ')
        : resolveResourceDisplayName('log', target, scoped)
    const title = workflow ? `${base} for ${workflow}` : base
    return workflow || workspaceName ? inWorkspace(title) : undefined
  }
  if (!resource) return undefined
  if (name === 'cli_files_read' && target?.includes('/')) return inWorkspace(base)
  const resolvedName = type && resolveResourceDisplayName(type, target, scoped)
  if (!resolvedName) return workspaceName ? inWorkspace(base) : undefined
  const noun = folder ? `${resource.noun} folder` : resource.noun
  const pattern = new RegExp(`\\b${noun}\\b`)
  const title = pattern.test(base)
    ? base.replace(pattern, () => resolvedName)
    : `${base}: ${resolvedName}`
  return resource.type === 'workspace' ? title : inWorkspace(title)
}
