import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { isPlainRecord } from '@sim/utils/object'
import { ActivityStatus } from '@/components/ui/activity-status'
import {
  CallIntegrationTool,
  PrepareFileEdit,
  Read as ReadTool,
  Terminal as TerminalTool,
  Wait as WaitTool,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { getReadTargetBlock } from '@/lib/copilot/tools/client/read-block'
import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/copilot/tools/retired-tools'
import { extractStreamingStringArgument } from '@/lib/copilot/tools/streaming-args'
import { getToolStatusDisplayTitle, getWaitCountdownTitle } from '@/lib/copilot/tools/tool-display'
import { ToolPermissionCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-permission-card'
import {
  BrowserTakeoverQuestion,
  CredentialDisplay,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import {
  getToolIcon,
  resolveToolDisplayState,
} from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { BrandIcon } from '@/blocks/brand-icon'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { getBlockByToolName } from '@/blocks/registry'

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

export interface ToolCallItemProps {
  toolName: string
  displayTitle: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  result?: ToolCallData['result']
  streamingArgs?: string
  /** Required for a gated row: the permission decision is posted against it. */
  toolCallId?: string
  /** When the call started, used to count down a running `wait`. */
  startedAt?: number
  /** Projects one computed status into a header and history without duplicating tool state. */
  renderStatus?: (status: ReactNode) => ReactNode
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key]
  return typeof value === 'string' ? value : ''
}

function browserTakeoverAnswer(result: ToolCallData['result']): string {
  if (!isPlainRecord(result?.output)) return 'Continue'
  const instruction = result.output.userInstruction
  return typeof instruction === 'string' && instruction.trim() ? instruction.trim() : 'Continue'
}

/** Reads a field out of the terminal tool's nested `args` object. */
function nestedStringParam(params: Record<string, unknown> | undefined, key: string): string {
  const args = params?.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/**
 * How often the countdown re-reads the clock. Comfortably under a second so
 * the displayed number turns over close to when it actually should, rather
 * than drifting by most of a second against an interval that started late.
 */
const COUNTDOWN_TICK_MS = 250

/**
 * Milliseconds elapsed since the call started, while `active`.
 *
 * Anchors to `startedAt` so a row that mounts partway through a pause resumes
 * mid-countdown instead of restarting; falls back to activation time when the
 * caller has no start to give.
 */
function useElapsedMs(
  active: boolean,
  startedAt: number | undefined,
  toolCallId: string | undefined
): number {
  const [sample, setSample] = useState({ toolCallId, elapsedMs: 0 })

  useEffect(() => {
    if (!active) return
    const anchor = startedAt ?? Date.now()
    const tick = () => setSample({ toolCallId, elapsedMs: Date.now() - anchor })
    tick()
    const interval = setInterval(tick, COUNTDOWN_TICK_MS)
    return () => clearInterval(interval)
  }, [active, startedAt, toolCallId])

  return active && sample.toolCallId === toolCallId ? sample.elapsedMs : 0
}

/**
 * Inline tool activity: shimmer while executing, a
 * static label once terminal. For `workspace_file` the title is derived live
 * from the streaming args; because that path bypasses the completed-title
 * rewrite in `toToolData`, the past-tense flip is applied here on success.
 * A `read` of a block or integration schema shows the block's brand icon
 * inline next to its display name (e.g. the Gmail logo before "Read Gmail").
 * The status-aware rewrite is repeated at this final rendering boundary so
 * live, replayed, and directly-constructed rows cannot bypass completed verbs.
 * An executing `browser_request_takeover` is lifted by AgentGroup into its
 * parent flow; this row remains the canonical completed-history entry after
 * the browser agent resumes.
 */
export function ToolCallItem({
  toolName,
  displayTitle,
  status,
  params,
  result,
  streamingArgs,
  toolCallId,
  startedAt,
  renderStatus,
}: ToolCallItemProps) {
  useCustomBlockOverlayVersion()
  const readPath = params?.path
  const readBlock =
    toolName === ReadTool.id && typeof readPath === 'string'
      ? getReadTargetBlock(readPath)
      : undefined

  // Like read's VFS-target resolution above, the gateway uses its exact
  // discovered toolId only as a deterministic registry lookup. This renders
  // the real integration brand while Go validates/resolves the operation.
  const gatewayBlock = useMemo(() => {
    if (toolName !== CallIntegrationTool.id) return undefined
    const toolId = params?.toolId ?? extractStreamingStringArgument(streamingArgs, 'toolId')
    return typeof toolId === 'string' ? getBlockByToolName(toolId) : undefined
  }, [toolName, params, streamingArgs])

  const liveWorkspaceFileTitle = useMemo(() => {
    if (toolName !== PrepareFileEdit.id || !streamingArgs) return null
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

  const displayState = resolveToolDisplayState(status)
  const isExecuting = displayState === 'spinner'
  const isBrowserTakeover = toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID

  const isCountingDown = toolName === WaitTool.id && isExecuting
  const elapsedMs = useElapsedMs(isCountingDown, startedAt, toolCallId)

  const liveTitle = isCountingDown
    ? getWaitCountdownTitle(params, elapsedMs)
    : liveWorkspaceFileTitle || displayTitle
  const title = getToolStatusDisplayTitle(liveTitle, status, toolName)

  // A waiting terminal handoff swaps its row for the hand-back chip, the same
  // way a browser takeover does: the row would otherwise spin with nothing
  // saying the shell is blocked on the user.
  const terminalHandoff =
    toolName === TerminalTool.id && isExecuting && stringParam(params, 'operation') === 'handoff'
      ? {
          terminalId: nestedStringParam(params, 'terminalId'),
          reason: nestedStringParam(params, 'reason'),
        }
      : null

  const BlockIcon = (readBlock ?? gatewayBlock ?? getBlockByToolName(toolName))?.icon
  const ToolIcon = getToolIcon(toolName)

  if (displayState === 'awaiting_approval' && toolCallId) {
    return (
      <ToolPermissionCard
        toolCallId={toolCallId}
        toolName={toolName}
        displayTitle={liveTitle}
        params={params}
      />
    )
  }

  if (isBrowserTakeover && isExecuting) return null

  if (isBrowserTakeover && status === 'success') {
    return (
      <BrowserTakeoverQuestion
        reason={stringParam(params, 'reason')}
        answer={browserTakeoverAnswer(result)}
      />
    )
  }

  if (terminalHandoff) {
    return (
      <CredentialDisplay
        data={[
          {
            type: 'terminal_handoff',
            value: terminalHandoff.terminalId,
            name: terminalHandoff.reason,
          },
        ]}
      />
    )
  }

  const activity = (
    <ActivityStatus
      label={title}
      isActive={isExecuting}
      icon={
        BlockIcon ? (
          <BrandIcon icon={BlockIcon} className='size-full' />
        ) : (
          <ToolIcon className='size-full' />
        )
      }
    />
  )
  return renderStatus ? renderStatus(activity) : activity
}
