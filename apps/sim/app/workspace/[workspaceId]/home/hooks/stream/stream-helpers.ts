import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import {
  CrawlWebsite,
  DeleteWorkflow,
  DeployApi,
  DeployChat,
  DeployMcp,
  FunctionExecute,
  Glob,
  Grep,
  ManageCredential,
  ManageCredentialOperation,
  ManageCustomTool,
  ManageCustomToolOperation,
  ManageFolder,
  ManageFolderOperation,
  ManageMcpTool,
  ManageMcpToolOperation,
  ManageScheduledTask,
  ManageScheduledTaskOperation,
  ManageSkill,
  ManageSkillOperation,
  MoveWorkflow,
  QueryLogs,
  Redeploy,
  RenameWorkflow,
  RunFromBlock,
  RunWorkflow,
  RunWorkflowUntilBlock,
  ScrapePage,
  SearchOnline,
  WorkspaceFile,
  WorkspaceFileOperation,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resources/types'
import { getToolDisplayTitle } from '@/lib/copilot/tools/tool-display'
import type { ContentBlock, MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { getWorkflowById } from '@/hooks/queries/utils/workflow-cache'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('StreamHelpers')

export const FILE_SUBAGENT_ID = 'file'

export const DEPLOY_TOOL_NAMES: Set<string> = new Set([
  DeployApi.id,
  DeployChat.id,
  DeployMcp.id,
  Redeploy.id,
])

export const FOLDER_TOOL_NAMES: Set<string> = new Set([ManageFolder.id])

export const WORKFLOW_MUTATION_TOOL_NAMES: Set<string> = new Set([
  MoveWorkflow.id,
  RenameWorkflow.id,
  DeleteWorkflow.id,
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

function resolveLeafWorkflowPathSegment(segments: string[]): string | undefined {
  const lastSegment = segments[segments.length - 1]
  if (!lastSegment) return undefined
  if (/\.[^/.]+$/.test(lastSegment) && segments.length > 1) {
    return segments[segments.length - 2]
  }
  return lastSegment
}

export function extractResourceFromReadResult(
  path: string | undefined,
  output: unknown
): MothershipResource | null {
  if (!path) return null

  const segments = path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  const resourceType = VFS_DIR_TO_RESOURCE[segments[0]]
  if (!resourceType || !segments[1]) return null

  const obj = output && typeof output === 'object' ? (output as Record<string, unknown>) : undefined
  if (!obj) return null

  let id = obj.id as string | undefined
  let name = obj.name as string | undefined

  if (!id && typeof obj.content === 'string') {
    try {
      const parsed = JSON.parse(obj.content)
      id = parsed?.id as string | undefined
      name = parsed?.name as string | undefined
    } catch {}
  }

  const fallbackTitle =
    resourceType === 'workflow'
      ? resolveLeafWorkflowPathSegment(segments)
      : segments[1] || segments[segments.length - 1]

  if (!id) return null
  return { type: resourceType, id, title: name || fallbackTitle || id }
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
    case WorkspaceFileOperation.append:
      verb = 'Adding'
      break
    case WorkspaceFileOperation.patch:
      verb = 'Editing'
      break
    case WorkspaceFileOperation.update:
      verb = 'Writing'
      break
  }

  if (chunkTitle) return `${verb} ${chunkTitle}`
  if (fileName) return `${verb} ${fileName}`
  return undefined
}

function resolveOperationDisplayTitle(
  operation: unknown,
  labels: Partial<Record<string, string>>,
  fallback: string
): string {
  const label = typeof operation === 'string' ? labels[operation] : undefined
  return label ?? fallback
}

function functionExecuteTitle(title: string | undefined): string {
  return title ?? 'Running code'
}

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

  if (name === QueryLogs.id) {
    const workflowName =
      resolveWorkflowNameForDisplay(args?.workflowId) ?? stringParam(args?.workflowName)
    if (workflowName) return `Querying logs for ${workflowName}`
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

export function resolveStreamingToolDisplayTitle(
  name: string,
  streamingArgs: string
): string | undefined {
  if (name === FunctionExecute.id) {
    return functionExecuteTitle(matchStreamingStringArg(streamingArgs, 'title'))
  }

  if (name === WorkspaceFile.id) {
    return resolveWorkspaceFileDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      matchStreamingStringArg(streamingArgs, 'title'),
      matchStreamingStringArg(streamingArgs, 'fileName')
    )
  }

  if (name === SearchOnline.id) {
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

  if (name === ScrapePage.id) {
    const url = matchStreamingStringArg(streamingArgs, 'url')
    return url ? `Scraping ${url}` : undefined
  }

  if (name === CrawlWebsite.id) {
    const url = matchStreamingStringArg(streamingArgs, 'url')
    return url ? `Crawling ${url}` : undefined
  }

  if (name === ManageCustomTool.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageCustomToolOperation.add]: 'Creating custom tool',
        [ManageCustomToolOperation.edit]: 'Updating custom tool',
        [ManageCustomToolOperation.delete]: 'Deleting custom tool',
        [ManageCustomToolOperation.list]: 'Listing custom tools',
      },
      'Custom tool action'
    )
  }

  if (name === ManageMcpTool.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageMcpToolOperation.add]: 'Creating MCP server',
        [ManageMcpToolOperation.edit]: 'Updating MCP server',
        [ManageMcpToolOperation.delete]: 'Deleting MCP server',
        [ManageMcpToolOperation.list]: 'Listing MCP servers',
      },
      'MCP server action'
    )
  }

  if (name === ManageSkill.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageSkillOperation.add]: 'Creating skill',
        [ManageSkillOperation.edit]: 'Updating skill',
        [ManageSkillOperation.delete]: 'Deleting skill',
        [ManageSkillOperation.list]: 'Listing skills',
      },
      'Skill action'
    )
  }

  if (name === ManageScheduledTask.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageScheduledTaskOperation.create]: 'Creating scheduled task',
        [ManageScheduledTaskOperation.get]: 'Getting scheduled task',
        [ManageScheduledTaskOperation.update]: 'Updating scheduled task',
        [ManageScheduledTaskOperation.delete]: 'Deleting scheduled task',
        [ManageScheduledTaskOperation.list]: 'Listing scheduled tasks',
      },
      'Scheduled task action'
    )
  }

  if (name === ManageCredential.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageCredentialOperation.rename]: 'Renaming credential',
        [ManageCredentialOperation.delete]: 'Deleting credential',
      },
      'Credential action'
    )
  }

  if (name === ManageFolder.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageFolderOperation.create]: 'Creating folder',
        [ManageFolderOperation.rename]: 'Renaming folder',
        [ManageFolderOperation.move]: 'Moving folder',
        [ManageFolderOperation.delete]: 'Deleting folder',
      },
      'Folder action'
    )
  }

  return undefined
}
