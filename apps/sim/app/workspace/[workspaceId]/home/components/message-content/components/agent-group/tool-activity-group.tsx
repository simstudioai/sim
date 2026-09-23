'use client'

import { type ComponentType, Fragment, useState } from 'react'
import { ActivityStatus } from '@/components/ui/activity-status'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import { readToolActivity } from '@/lib/mothership/tools/tool-activity'
import { getToolStatusDisplayTitle } from '@/lib/mothership/tools/tool-display'
import { ActivityStream } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-stream'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { getActivityAttentionKey } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
import { isToolDone } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

function isFailedTool(tool: ToolCallData): boolean {
  return tool.status === ToolCallStatus.error || tool.status === ToolCallStatus.rejected
}

function toolCountLabel(tools: ToolCallData[]): string {
  return `${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`
}

/** Summarize completed actions without describing failed or skipped work as successful. */
export function getToolActivitySummary(tools: ToolCallData[]): string {
  const statusTool = getActivityStatusTool(tools)
  if (!statusTool || (tools.length > 1 && isFailedTool(statusTool))) return toolCountLabel(tools)
  const label = getToolStatusDisplayTitle(
    statusTool.displayTitle,
    statusTool.status,
    statusTool.toolName,
    statusTool.activityDescription
  )
  const visibleCount = tools.filter((tool) => !isFailedTool(tool)).length
  return getActiveToolActivityTitle(
    `${label}${visibleCount > 1 ? ` + ${visibleCount - 1}` : ''}`,
    statusTool,
    tools
  )
}

function getToolActivityInterruptions(tools: ToolCallData[]): string[] {
  let stopped = 0
  let skipped = 0
  for (const tool of tools) {
    if (tool.status === ToolCallStatus.cancelled || tool.status === ToolCallStatus.interrupted)
      stopped++
    else if (tool.status === ToolCallStatus.skipped) skipped++
  }
  return [...(stopped ? [`${stopped} stopped`] : []), ...(skipped ? [`${skipped} skipped`] : [])]
}

/** Keep earlier interruptions visible while the latest action continues. */
export function getActiveToolActivityTitle(
  label: string,
  tool: ToolCallData,
  tools: ToolCallData[]
): string {
  return tool.status === ToolCallStatus.executing || tool.status === ToolCallStatus.success
    ? [label, ...getToolActivityInterruptions(tools)].join(' · ')
    : label
}

/** Keep running work visible until every parallel call finishes. */
export function getActivityStatusTool(tools: ToolCallData[]): ToolCallData | undefined {
  return (
    tools.reduce<ToolCallData | undefined>(
      (newest, tool) =>
        !isToolDone(tool.status) && (!newest || (tool.startedAt ?? 0) >= (newest.startedAt ?? 0))
          ? tool
          : newest,
      undefined
    ) ??
    tools.filter((tool) => !isFailedTool(tool)).at(-1) ??
    tools.at(-1)
  )
}

interface ToolActivityGroupProps {
  activity?: ToolActivity
  completedGroupCount?: number
  tools: ToolCallData[]
  ToolCallComponent: ComponentType<ToolCallItemProps>
  autoScrollActivity?: boolean
  isActive?: boolean
}

export function ToolActivityGroup({
  activity,
  completedGroupCount = 0,
  tools,
  ToolCallComponent,
  autoScrollActivity = true,
  isActive = false,
}: ToolActivityGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const statusTool = getActivityStatusTool(tools)
  if (!statusTool) return null
  const groupedActivity =
    activity ??
    tools
      .map((tool) => readToolActivity(tool.params, tool.streamingArgs))
      .reverse()
      .find((entry) => entry?.title || entry?.completedTitle)
  const running = tools.filter((tool) => !isToolDone(tool.status))
  const working = running.length > 0
  const complete = !isActive && !working
  const headerActive = working && statusTool.status !== ToolCallStatus.awaiting_approval
  const attentionKey = getActivityAttentionKey(tools)
  /** A merged summary cannot claim success when any represented call did not complete. */
  const failedActivityTool = tools.find(
    (tool) => isToolDone(tool.status) && tool.status !== ToolCallStatus.success
  )
  const completedActivityLabel = groupedActivity?.completedTitle
    ? failedActivityTool
      ? isFailedTool(failedActivityTool)
        ? undefined
        : getToolStatusDisplayTitle(
            failedActivityTool.displayTitle,
            failedActivityTool.status,
            failedActivityTool.toolName,
            failedActivityTool.activityDescription
          )
      : groupedActivity.completedTitle
    : undefined
  const completedLabel = completedActivityLabel
    ? `${completedActivityLabel}${completedGroupCount > 1 ? ` + ${completedGroupCount - 1}` : ''}`
    : undefined
  const generatingCall =
    working &&
    (statusTool.toolName === 'sim_cli' || statusTool.toolName === 'run_code') &&
    Object.keys(statusTool.params ?? {}).every((key) => key === 'activity')

  return (
    <ToolCallComponent
      {...statusTool}
      toolCallId={statusTool.id}
      renderStatus={(status) => (
        <ActivityStream
          activity={{
            label:
              tools.length === 1
                ? generatingCall
                  ? 'Working…'
                  : status.label
                : working
                  ? getActiveToolActivityTitle(
                      `${generatingCall ? 'Working…' : status.label}${running.length > 1 ? ` + ${running.length - 1}` : ''}`,
                      statusTool,
                      tools
                    )
                  : complete
                    ? (completedLabel ?? getToolActivitySummary(tools))
                    : getActiveToolActivityTitle(status.label, statusTool, tools),
            isActive: headerActive,
          }}
          activityKey={statusTool.id}
          attentionKey={attentionKey}
          expandedLabel={tools.length > 1 ? groupedActivity?.title : undefined}
          collapsible={tools.length > 1}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          isStreaming={working && autoScrollActivity}
        >
          <div className='flex min-w-0 flex-col gap-1.5 py-0.5 pl-6'>
            {tools.map((tool) => (
              <Fragment key={tool.id}>
                {tool.id === statusTool.id ? (
                  <ActivityStatus {...status} />
                ) : (
                  <ToolCallComponent {...tool} toolCallId={tool.id} />
                )}
              </Fragment>
            ))}
          </div>
        </ActivityStream>
      )}
    />
  )
}
