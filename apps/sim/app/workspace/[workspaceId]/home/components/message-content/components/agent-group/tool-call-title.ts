import { useMemo } from 'react'
import { PrepareFileEdit, Wait as WaitTool } from '@/lib/mothership/generated/tool-catalog-v1'
import { extractStreamingStringArgument } from '@/lib/mothership/tools/streaming-args'
import {
  getToolInProgressTitle,
  getToolStatusDisplayTitle,
  getWaitCountdownTitle,
} from '@/lib/mothership/tools/tool-display'
import { useElapsedMs } from '@/app/workspace/[workspaceId]/home/hooks/use-elapsed-ms'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

/** Present participle for each `prepare_file_edit` operation, read from the streaming args. */
const FILE_EDIT_VERBS: Readonly<Record<string, string>> = {
  create: 'Creating',
  append: 'Adding',
  patch: 'Editing',
  update: 'Writing',
  rename: 'Renaming',
  delete: 'Deleting',
}

/**
 * A `prepare_file_edit` title read live from its streaming arguments, before
 * the parsed title exists; that path bypasses the completed-title rewrite in
 * `toToolData`, so the status-aware title applies it on success.
 */
function getLiveFileEditTitle(toolName?: string, streamingArgs?: string): string | null {
  if (toolName !== PrepareFileEdit.id || !streamingArgs) return null
  const title = extractStreamingStringArgument(streamingArgs, 'title')
  if (!title) return null
  const operation = extractStreamingStringArgument(streamingArgs, 'operation') ?? ''
  const verb = Object.hasOwn(FILE_EDIT_VERBS, operation) ? FILE_EDIT_VERBS[operation] : 'Writing'
  return `${verb} ${title}`
}

export type ToolCallTitleInput = Pick<
  ToolCallData,
  'toolName' | 'displayTitle' | 'activityDescription' | 'status' | 'params' | 'streamingArgs'
> & {
  toolCallId?: string
  startedAt?: number
}

export interface ToolCallTitle {
  /** The call's status-aware title, as its own row shows it. */
  label: string
  /** The call described as work in progress, as an open header shows it. */
  activeLabel: string
}

/**
 * The titles of one call, shared by its row and by any header that names it:
 * a running `wait` counts down, a streaming file edit names its file, and a
 * model description replaces the generic title.
 */
export function useToolCallTitle(tool: ToolCallTitleInput | undefined): ToolCallTitle | undefined {
  const toolName = tool?.toolName
  const streamingArgs = tool?.streamingArgs
  const liveFileEditTitle = useMemo(
    () => getLiveFileEditTitle(toolName, streamingArgs),
    [toolName, streamingArgs]
  )
  const isCountingDown = toolName === WaitTool.id && tool?.status === 'executing'
  const elapsedMs = useElapsedMs(isCountingDown, tool?.startedAt, tool?.toolCallId)
  if (!tool) return undefined
  const liveTitle = isCountingDown
    ? getWaitCountdownTitle(tool.params, elapsedMs)
    : liveFileEditTitle || tool.displayTitle
  const description = isCountingDown ? undefined : tool.activityDescription
  return {
    label: getToolStatusDisplayTitle(liveTitle, tool.status, tool.toolName, description),
    activeLabel: getToolInProgressTitle(liveTitle, tool.status, tool.toolName, description),
  }
}
