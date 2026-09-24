import { type ReactNode, useMemo } from 'react'
import { isPlainRecord } from '@sim/utils/object'
import { ActivityStatus, type ActivityStatusProps } from '@/components/ui/activity-status'
import {
  CallIntegrationTool,
  Read as ReadTool,
  Terminal as TerminalTool,
} from '@/lib/mothership/generated/tool-catalog-v1'
import { getReadTargetBlock } from '@/lib/mothership/tools/client/read-block'
import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/mothership/tools/retired-tools'
import { extractStreamingStringArgument } from '@/lib/mothership/tools/streaming-args'
import { useToolCallTitle } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-title'
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

export interface ToolCallItemProps {
  toolName: string
  displayTitle: string
  activityDescription?: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  result?: ToolCallData['result']
  streamingArgs?: string
  /** Required for a gated row: the permission decision is posted against it. */
  toolCallId?: string
  /** When the call started, used to count down a running `wait`. */
  startedAt?: number
  /** Projects one computed status into a header and history without duplicating tool state. */
  renderStatus?: (status: ToolActivityPresentation) => ReactNode
}

export interface ToolActivityPresentation extends ActivityStatusProps {
  /** Keep the action in progress while its containing activity group remains open. */
  activeLabel: string
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
 * Rows are history and never shimmer; the lane decides which header or search row is live.
 */
export function ToolCallItem({
  toolName,
  displayTitle,
  activityDescription,
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

  const displayState = resolveToolDisplayState(status)
  const isExecuting = displayState === 'spinner'
  const isBrowserTakeover = toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID

  const { label: title, activeLabel } = useToolCallTitle({
    toolCallId,
    toolName,
    displayTitle,
    activityDescription,
    status,
    params,
    streamingArgs,
    startedAt,
  }) ?? { label: displayTitle, activeLabel: displayTitle }

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
        displayTitle={title}
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

  const activity: ToolActivityPresentation = {
    label: title,
    activeLabel,
    isActive: false,
    icon: BlockIcon ? (
      <BrandIcon icon={BlockIcon} className='size-full' />
    ) : (
      <ToolIcon className='size-full' />
    ),
  }
  return renderStatus ? renderStatus(activity) : <ActivityStatus {...activity} />
}
