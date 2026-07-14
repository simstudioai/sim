import { useMemo } from 'react'
import { ShimmerText } from '@/components/ui'
import { WorkspaceFile } from '@/lib/copilot/generated/tool-catalog-v1'
import { getToolCompletedTitle } from '@/lib/copilot/tools/tool-display'
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
  streamingArgs?: string
}

export function ToolCallItem({ toolName, displayTitle, status, streamingArgs }: ToolCallItemProps) {
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
  // The live workspace_file title bypasses toToolData's completed-title rewrite,
  // so flip it to past tense here once the call succeeds.
  const title =
    status === 'success' && liveWorkspaceFileTitle
      ? (getToolCompletedTitle(liveTitle) ?? liveTitle)
      : liveTitle

  return (
    <div className='flex items-center pl-6'>
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
