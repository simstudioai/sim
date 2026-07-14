import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import {
  CrawlWebsite,
  CreateFile,
  CreateWorkflow,
  DeleteWorkflow,
  DeployApi,
  DeployChat,
  DeployMcp,
  EditWorkflow,
  FunctionExecute,
  Glob,
  Grep,
  ManageCredential,
  ManageCustomTool,
  ManageFolder,
  ManageMcpTool,
  ManageScheduledTask,
  ManageSkill,
  QueryLogs,
  Redeploy,
  RunFromBlock,
  RunWorkflow,
  RunWorkflowUntilBlock,
  ScrapePage,
  SearchOnline,
  WorkspaceFile,
  WorkspaceFileOperation,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resources/types'
import { getToolDisplayTitle, mvDisplayVerb } from '@/lib/copilot/tools/tool-display'
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

export const FOLDER_TOOL_NAMES: Set<string> = new Set([ManageFolder.id, 'mkdir', 'mv'])

export const WORKFLOW_MUTATION_TOOL_NAMES: Set<string> = new Set([
  'mv',
  'cp',
  DeleteWorkflow.id,
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

function resolveTargetWorkflowName(args: Record<string, unknown> | undefined): string | undefined {
  const explicitName = stringParam(args?.workflowName) ?? stringParam(args?.name)
  if (explicitName) return explicitName

  const registry = useWorkflowRegistry.getState()
  return resolveWorkflowNameForDisplay(args?.workflowId ?? registry.hydration.workflowId)
}

function resolveDeletedWorkflowTarget(workflowIds: unknown): string | undefined {
  if (!Array.isArray(workflowIds) || workflowIds.length === 0) return undefined
  const names = workflowIds
    .map(resolveWorkflowNameForDisplay)
    .filter((name): name is string => Boolean(name))
  if (names.length === 0) return undefined
  if (workflowIds.length === 1) return names[0]
  if (workflowIds.length === 2 && names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]} and ${workflowIds.length - 1} more`
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

  if (name === EditWorkflow.id) {
    const workflowName = resolveTargetWorkflowName(args)
    return workflowName ? `Editing ${workflowName}` : 'Editing workflow'
  }

  if (name === DeleteWorkflow.id) {
    const workflowTarget = resolveDeletedWorkflowTarget(args?.workflowIds)
    if (workflowTarget) return `Deleting ${workflowTarget}`
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

  if (name === CreateFile.id) {
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

  if (name === ScrapePage.id) {
    const url = matchStreamingStringArg(streamingArgs, 'url')
    return url ? `Scraping ${url}` : undefined
  }

  if (name === CrawlWebsite.id) {
    const url = matchStreamingStringArg(streamingArgs, 'url')
    return url ? `Crawling ${url}` : undefined
  }

  if (name === ManageCustomTool.id) {
    return resolveStreamingManagedResourceTitle(name, streamingArgs, ['toolTitle', 'title', 'name'])
  }

  if (name === ManageMcpTool.id) {
    return resolveStreamingManagedResourceTitle(name, streamingArgs, [
      'serverName',
      'name',
      'title',
    ])
  }

  if (name === ManageSkill.id) {
    return resolveStreamingManagedResourceTitle(name, streamingArgs, ['name', 'skillName', 'title'])
  }

  if (name === ManageScheduledTask.id) {
    return resolveStreamingManagedResourceTitle(name, streamingArgs, ['title', 'taskName', 'name'])
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

  if (name === ManageFolder.id) {
    // create/rename/move are string literals: the live tool only offers delete
    // (mkdir/mv replaced the rest), but grace-period checkpoint resumes and
    // transcript replays still stream the legacy operations.
    const operation = matchStreamingStringArg(streamingArgs, 'operation')
    if (!operation) return undefined
    return getToolDisplayTitle(name, {
      operation,
      path:
        matchStreamingStringArg(streamingArgs, 'oldPath') ??
        matchStreamingStringArg(streamingArgs, 'source') ??
        matchStreamingStringArg(streamingArgs, 'path'),
      name:
        matchStreamingStringArg(streamingArgs, 'newPath') ??
        matchStreamingStringArg(streamingArgs, 'destination') ??
        matchStreamingStringArg(streamingArgs, 'newName') ??
        matchStreamingStringArg(streamingArgs, 'name'),
    })
  }

  return undefined
}
