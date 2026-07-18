import { useMemo } from 'react'
import { ShimmerText } from '@/components/ui'
import {
  CallIntegrationTool,
  Read as ReadTool,
  WorkspaceFile,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { getReadTargetBlock } from '@/lib/copilot/tools/client/read-block'
import { extractStreamingStringArgument } from '@/lib/copilot/tools/streaming-args'
import { getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import { getBareIconStyle } from '@/blocks/icon-color'
import { getBlockByToolName } from '@/blocks/registry'
import type { ToolCallStatus } from '../../../../types'
import { resolveToolDisplayState } from '../../utils'

export function CircleStop({ className }: { className?: string }) {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
    >
      <circle cx='8' cy='8' r='6.5' stroke='currentColor' strokeWidth='1.25' />
      <rect x='6' y='6' width='4' height='4' rx='0.5' fill='currentColor' />
    </svg>
  )
}

interface ToolCallItemProps {
  toolName: string
  displayTitle: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  streamingArgs?: string
}

/**
 * A single tool-call row inside an agent group: shimmer while executing, a
 * static label once terminal. For `workspace_file` the title is derived live
 * from the streaming args; because that path bypasses the completed-title
 * rewrite in `toToolData`, the past-tense flip is applied here on success.
 * A `read` of a block or integration schema shows the block's brand icon
 * inline next to its display name (e.g. the Gmail logo before "Read Gmail").
 * The status-aware rewrite is repeated at this final rendering boundary so
 * live, replayed, and directly-constructed rows cannot bypass completed verbs.
 */
export function ToolCallItem({
  toolName,
  displayTitle,
  status,
  params,
  streamingArgs,
}: ToolCallItemProps) {
  const readBlock = useMemo(() => {
    if (toolName !== ReadTool.id) return undefined
    const path = params?.path
    return typeof path === 'string' ? getReadTargetBlock(path) : undefined
  }, [toolName, params])

  // Like read's VFS-target resolution above, the gateway uses its exact
  // discovered toolId only as a deterministic registry lookup. This renders
  // the real integration brand while Go validates/resolves the operation.
  const gatewayBlock = useMemo(() => {
    if (toolName !== CallIntegrationTool.id) return undefined
    const toolId = params?.toolId ?? extractStreamingStringArgument(streamingArgs, 'toolId')
    return typeof toolId === 'string' ? getBlockByToolName(toolId) : undefined
  }, [toolName, params, streamingArgs])

  const liveWorkspaceFileTitle = useMemo(() => {
    if (toolName !== WorkspaceFile.id || !streamingArgs) return null
    const titleMatch = streamingArgs.match(/"title"\s*:\s*"([^"]+)"/)
    if (!titleMatch?.[1]) return null
    const opMatch = streamingArgs.match(/"operation"\s*:\s*"(\w+)"/)
    const op = opMatch?.[1] ?? ''
    const verb =
      op === 'create'
        ? 'Creating'
        : op === 'append'
          ? 'Adding'
          : op === 'patch'
            ? 'Editing'
            : op === 'update'
              ? 'Writing'
              : op === 'rename'
                ? 'Renaming'
                : op === 'delete'
                  ? 'Deleting'
                  : 'Writing'
    const unescaped = titleMatch[1]
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
    return `${verb} ${unescaped}`
  }, [toolName, streamingArgs])

  const isExecuting = resolveToolDisplayState(status) === 'spinner'
  const liveTitle = liveWorkspaceFileTitle || displayTitle
  const title = getToolStatusDisplayTitle(liveTitle, status)

  const BlockIcon = (readBlock ?? gatewayBlock ?? getBlockByToolName(toolName))?.icon

  return (
    <div className='flex items-center gap-[6px] pl-6'>
      {BlockIcon && (
        // Size via inline style: a custom block's image icon carries a trailing
        // `size-full` that defeats size *classes* (it fills tiled surfaces), so a
        // class-only size renders the uploaded icon at natural size here.
        <BlockIcon
          className='size-[14px] flex-shrink-0'
          style={{ width: 14, height: 14, ...getBareIconStyle(BlockIcon) }}
        />
      )}
      {isExecuting ? (
        <ShimmerText className='text-[13px] [--shimmer-rest:var(--text-secondary)]'>
          {title}
        </ShimmerText>
      ) : (
        <span className='text-[13px] text-[var(--text-secondary)]'>{title}</span>
      )}
    </div>
  )
}
