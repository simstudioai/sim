import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import {
  CallIntegrationTool,
  CreateEmptyFile,
  CreateWorkflow,
  DeployAsApi,
  DeployAsChat,
  DeployAsMcp,
  EditWorkflow,
  Glob,
  Grep,
  ManageCredential,
  ManageCustomTool,
  ManageMcpConnection,
  ManageSkill,
  PrepareFileEdit,
  PrepareFileEditOperation,
  QueryLogs,
  Redeploy,
  Rm,
  RunFromBlock,
  RunFunction,
  RunWorkflow,
  RunWorkflowUntilBlock,
  WebCrawl,
  WebScrape,
  WebSearch,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { extractStreamingStringArgument } from '@/lib/copilot/tools/streaming-args'
import { getToolDisplayTitle, mvDisplayVerb } from '@/lib/copilot/tools/tool-display'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { getWorkflowById } from '@/hooks/queries/utils/workflow-cache'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('StreamHelpers')

export const FILE_SUBAGENT_ID = 'file'

export const DEPLOY_TOOL_NAMES: Set<string> = new Set([
  DeployAsApi.id,
  DeployAsChat.id,
  DeployAsMcp.id,
  Redeploy.id,
])

export const FOLDER_TOOL_NAMES: Set<string> = new Set([Rm.id, 'mkdir', 'mv'])

export const WORKFLOW_MUTATION_TOOL_NAMES: Set<string> = new Set([
  'mv',
  'cp',
  Rm.id,
  // Removed legacy tools, kept while their grace-period executors remain.
  'move_workflow',
  'rename_workflow',
])

export type StreamPayload = Record<string, unknown>

export function asPayloadRecord(value: unknown): StreamPayload | undefined {
  return isRecordLike(value) ? value : undefined
}

/**
 * Settles any tool row still `executing` at a turn terminal by propagating the
 * turn's outcome — the deterministic replacement for the old `interrupted`
 * invention. A clean `complete` means the turn succeeded, so a straggler is
 * settled `success` (with explicit tool/span terminals from the backend there
 * are normally none); a stop settles `cancelled`; an error settles `error`.
 */
export function finalizeResidualToolCalls(
  blocks: ContentBlock[],
  turnTerminal: 'complete' | 'cancelled' | 'error'
): void {
  const endedAt = Date.now()
  const propagated =
    turnTerminal === 'cancelled'
      ? ToolCallStatus.cancelled
      : turnTerminal === 'error'
        ? ToolCallStatus.error
        : ToolCallStatus.success
  for (const block of blocks) {
    // Close any still-open subagent lane at the turn terminal so its group
    // resolves deterministically even when the backend cut off before a
    // `span end` (abort/disconnect). The projection treats a stamped `endedAt`
    // as a closed group, so the delegating spinner clears without any
    // transport-based gating.
    if (block.type === 'subagent' && block.endedAt === undefined) {
      block.endedAt = endedAt
      continue
    }
    const tc = block.toolCall
    if (!tc || tc.status !== ToolCallStatus.executing) continue
    tc.status = propagated
    if (propagated === ToolCallStatus.cancelled) {
      tc.displayTitle = 'Stopped by user'
    }
    if (block.endedAt === undefined) {
      block.endedAt = endedAt
    }
  }
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function resolveWorkflowNameForDisplay(workflowId: unknown): string | undefined {
  const id = stringParam(workflowId)
  if (!id) return undefined
  const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
  if (!workspaceId) return undefined
  return getWorkflowById(workspaceId, id)?.name
}

function resolveTargetWorkflowName(args: Record<string, unknown> | undefined): string | undefined {
  const explicitName = stringParam(args?.workflowName) ?? stringParam(args?.name)
  if (explicitName) return explicitName

  const registry = useWorkflowRegistry.getState()
  return resolveWorkflowNameForDisplay(args?.workflowId ?? registry.hydration.workflowId)
}

/**
 * Table name for a nested `args.tableId`. Tables reach the client through
 * React Query rather than a Zustand store, so the cached workspace list is
 * the synchronous source a title can read; an uncached id simply stays
 * unnamed rather than blocking the row.
 */
function resolveTableNameForDisplay(tableId: unknown): string | undefined {
  const id = stringParam(tableId)
  if (!id) return undefined
  const cache = getQueryClient().getQueryCache()
  for (const query of cache.findAll({ queryKey: tableKeys.lists() })) {
    const data = query.state.data
    const tables = Array.isArray(data)
      ? data
      : isRecordLike(data) && Array.isArray((data as { tables?: unknown }).tables)
        ? ((data as { tables: unknown[] }).tables as unknown[])
        : []
    for (const table of tables) {
      if (!isRecordLike(table)) continue
      if (stringParam(table.id) !== id) continue
      const name = stringParam(table.name)
      if (name) return name
    }
  }
  return undefined
}

function resolveBlockNameForDisplay(blockId: unknown): string | undefined {
  const id = stringParam(blockId)
  if (!id) return undefined
  return useWorkflowStore.getState().blocks[id]?.name
}

function resolveWorkspaceFileDisplayTitle(
  operation: unknown,
  title: unknown,
  targetFileName?: unknown
): string | undefined {
  const chunkTitle = stringParam(title)
  const fileName = stringParam(targetFileName)
  let verb = 'Writing'

  switch (operation) {
    case PrepareFileEditOperation.append:
      verb = 'Adding'
      break
    case PrepareFileEditOperation.patch:
      verb = 'Editing'
      break
    case PrepareFileEditOperation.update:
      verb = 'Writing'
      break
  }

  if (chunkTitle) return `${verb} ${chunkTitle}`
  if (fileName) return `${verb} ${fileName}`
  return undefined
}

function functionExecuteTitle(title: string | undefined): string {
  return title ?? 'Running code'
}

/**
 * Row text for an integration-gateway tool call: the model-authored activity
 * `description`, readable the moment it completes in the still-streaming
 * argument buffer — the same pattern `read`/`workspace_file` use for their
 * streaming VFS targets. The trusted integration branding is the ICON, which
 * the row component derives deterministically from the streamed `toolId` (or
 * the rebound operation name) via Sim's block registry — the text carries no
 * integration name. After Go's authoritative frame rebinds the row to the
 * exact operation (e.g. `gmail_read_v2`), the preserved
 * `integrationDescription` keeps the same text. Returns undefined until a
 * description is readable (callers fall back to the neutral gateway label).
 */
export function resolveIntegrationToolDisplayTitle(tool: {
  name: string
  args?: Record<string, unknown>
  streamingArgs?: string
  integrationDescription?: string
}): string | undefined {
  if (tool.name === CallIntegrationTool.id) {
    const description =
      stringParam(tool.args?.description) ??
      extractStreamingStringArgument(tool.streamingArgs, 'description')?.trim()
    return description || undefined
  }
  return tool.integrationDescription
}

/**
 * Tools whose subject is one workflow. They accept a `workflowId` (or imply
 * the current workflow), so their titles can only name the workflow once the
 * client resolves the id against the workflow registry.
 */
const TABLE_SCOPED_TOOL_IDS = new Set<string>([
  'table_automations',
  'table_columns',
  'table_enrichments',
  'table_manage',
  'table_rows',
  'table_views',
])

const WORKFLOW_SCOPED_TOOL_IDS = new Set<string>([
  'deploy_as_api',
  'diff_workflows',
  'list_deployment_versions',
  'publish_custom_block',
  'deploy_as_chat',
  'deploy_as_mcp',
  'get_block_outputs',
  'get_block_upstream_references',
  'get_deployed_workflow_state',
  'get_deployment_status',
  'get_workflow_data',
  'get_workflow_run_options',
  'promote_to_live',
  'redeploy',
  'run_block',
  'set_block_enabled',
  'set_global_workflow_variables',
])

export function resolveToolDisplayTitle(name: string, args?: Record<string, unknown>): string {
  // Cases that enrich the title with live workspace/block names from the client
  // stores. Everything else is resolved by the shared name+args resolver, which
  // is the single source of truth for tool-call titles.
  if (name === RunWorkflow.id) {
    const workflowName = resolveWorkflowNameForDisplay(args?.workflowId)
    return workflowName ? `Running ${workflowName}` : 'Running workflow'
  }

  if (name === RunFromBlock.id) {
    const workflowName = resolveWorkflowNameForDisplay(args?.workflowId)
    const blockName = resolveBlockNameForDisplay(args?.startBlockId)
    if (workflowName && blockName) return `Running ${workflowName} from ${blockName}`
    if (workflowName) return `Running ${workflowName}`
    if (blockName) return `Running from ${blockName}`
    return 'Running workflow'
  }

  if (name === RunWorkflowUntilBlock.id) {
    const workflowName = resolveWorkflowNameForDisplay(args?.workflowId)
    const blockName = resolveBlockNameForDisplay(args?.stopAfterBlockId)
    if (workflowName && blockName) return `Running ${workflowName} until ${blockName}`
    if (workflowName) return `Running ${workflowName}`
    if (blockName) return `Running until ${blockName}`
    return 'Running workflow'
  }

  if (name === EditWorkflow.id) {
    const workflowName = resolveTargetWorkflowName(args)
    return workflowName ? `Editing ${workflowName}` : 'Editing workflow'
  }

  if (name === QueryLogs.id) {
    const workflowName =
      resolveWorkflowNameForDisplay(args?.workflowId) ?? stringParam(args?.workflowName)
    if (workflowName) return `Querying logs for ${workflowName}`
  }

  // Workflow-scoped tools carry an id, not a name — and often not even that,
  // defaulting to the current workflow. Resolve the name here and hand it to
  // the shared resolver as `workflowName`, which every workflow title already
  // reads, so deployments, reads, and block work all say WHICH workflow.
  // Table tools keep their operands nested under `args`, and identify the
  // table by id — so the shared resolver sees neither the column being added
  // nor which table it belongs to. Lift both here.
  if (TABLE_SCOPED_TOOL_IDS.has(name)) {
    const nested = isRecordLike(args?.args) ? (args?.args as Record<string, unknown>) : undefined
    const tableName =
      stringParam(args?.tableName) ?? resolveTableNameForDisplay(nested?.tableId ?? args?.tableId)
    if (nested || tableName) {
      return getToolDisplayTitle(name, {
        ...args,
        ...(nested ?? {}),
        ...(tableName ? { tableName } : {}),
      })
    }
  }

  if (WORKFLOW_SCOPED_TOOL_IDS.has(name) && !stringParam(args?.workflowName)) {
    const workflowName = resolveTargetWorkflowName(args)
    // Block-scoped tools carry a blockId for the same reason; resolve it too,
    // so a row says which block ran rather than an opaque id (or nothing).
    const blockName = stringParam(args?.blockName) ?? resolveBlockNameForDisplay(args?.blockId)
    const enriched = {
      ...args,
      ...(workflowName ? { workflowName } : {}),
      ...(blockName ? { blockName } : {}),
    }
    if (workflowName || blockName) return getToolDisplayTitle(name, enriched)
  }

  return getToolDisplayTitle(name, args)
}

function decodeStreamingString(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_: string, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function matchStreamingStringArg(streamingArgs: string, key: string): string | undefined {
  const match = streamingArgs.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'm'))
  return match?.[1] ? decodeStreamingString(match[1]) : undefined
}

function resolveStreamingManagedResourceTitle(
  name: string,
  streamingArgs: string,
  targetKeys: string[]
): string | undefined {
  const operation = matchStreamingStringArg(streamingArgs, 'operation')
  if (!operation) return undefined
  let target: string | undefined
  for (const key of targetKeys) {
    target = matchStreamingStringArg(streamingArgs, key)
    if (target) break
  }
  return getToolDisplayTitle(name, {
    operation,
    ...(target
      ? {
          title: target,
          name: target,
          displayName: target,
          path: target,
        }
      : {}),
  })
}

export function resolveStreamingToolDisplayTitle(
  name: string,
  streamingArgs: string
): string | undefined {
  if (name === RunFunction.id) {
    return functionExecuteTitle(matchStreamingStringArg(streamingArgs, 'title'))
  }

  if (name === PrepareFileEdit.id) {
    return resolveWorkspaceFileDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      matchStreamingStringArg(streamingArgs, 'title'),
      matchStreamingStringArg(streamingArgs, 'fileName')
    )
  }

  if (name === CreateEmptyFile.id) {
    const target =
      matchStreamingStringArg(streamingArgs, 'path') ??
      matchStreamingStringArg(streamingArgs, 'fileName')
    return target ? getToolDisplayTitle(name, { fileName: target }) : undefined
  }

  if (name === CreateWorkflow.id) {
    const workflowName = matchStreamingStringArg(streamingArgs, 'name')
    return workflowName ? getToolDisplayTitle(name, { name: workflowName }) : undefined
  }

  if (name === EditWorkflow.id) {
    const workflowId = matchStreamingStringArg(streamingArgs, 'workflowId')
    return workflowId ? resolveToolDisplayTitle(name, { workflowId }) : undefined
  }

  if (name === WebSearch.id) {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Searching online for ${toolTitle}` : undefined
  }

  if (name === Grep.id) {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Searching for ${toolTitle}` : undefined
  }

  if (name === Glob.id) {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Finding ${toolTitle}` : undefined
  }

  if (name === 'mv') {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    if (!toolTitle) return undefined
    // Same rename-vs-move derivation as the settled title: single source with
    // only the leaf changing reads as a rename.
    const multiSource = /"sources"\s*:\s*\[\s*"[^"]*"\s*,/.test(streamingArgs)
    const firstSource = streamingArgs.match(/"sources"\s*:\s*\[\s*"([^"]*)"/m)?.[1]
    const destination = matchStreamingStringArg(streamingArgs, 'destination')
    const verb = multiSource
      ? 'Moving'
      : mvDisplayVerb(firstSource ? decodeStreamingString(firstSource) : undefined, destination)
    if (verb === 'Renaming' && firstSource && destination) {
      return getToolDisplayTitle(name, {
        sources: [decodeStreamingString(firstSource)],
        destination,
      })
    }
    return `${verb} ${toolTitle}`
  }

  if (name === 'cp') {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Duplicating ${toolTitle}` : undefined
  }

  if (name === 'mkdir') {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Creating ${toolTitle}` : undefined
  }

  if (name === 'rm') {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Deleting ${toolTitle}` : undefined
  }

  if (name === WebScrape.id) {
    const url = matchStreamingStringArg(streamingArgs, 'url')
    return url ? `Scraping ${url}` : undefined
  }

  if (name === WebCrawl.id) {
    const url = matchStreamingStringArg(streamingArgs, 'url')
    return url ? `Crawling ${url}` : undefined
  }

  if (name === ManageCustomTool.id) {
    return resolveStreamingManagedResourceTitle(name, streamingArgs, ['toolTitle', 'title', 'name'])
  }

  if (name === ManageMcpConnection.id) {
    return resolveStreamingManagedResourceTitle(name, streamingArgs, [
      'serverName',
      'name',
      'title',
    ])
  }

  if (name === ManageSkill.id) {
    return resolveStreamingManagedResourceTitle(name, streamingArgs, ['name', 'skillName', 'title'])
  }

  if (name === ManageCredential.id) {
    const operation = matchStreamingStringArg(streamingArgs, 'operation')
    if (!operation) return undefined
    return getToolDisplayTitle(name, {
      operation,
      previousDisplayName:
        matchStreamingStringArg(streamingArgs, 'previousDisplayName') ??
        matchStreamingStringArg(streamingArgs, 'oldName') ??
        matchStreamingStringArg(streamingArgs, 'credentialName'),
      displayName:
        matchStreamingStringArg(streamingArgs, 'displayName') ??
        matchStreamingStringArg(streamingArgs, 'newName') ??
        matchStreamingStringArg(streamingArgs, 'name'),
    })
  }

  return undefined
}
