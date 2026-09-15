'use client'

import { type ComponentType, Fragment, useState } from 'react'
import { ActivityStatus } from '@/components/ui/activity-status'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import {
  getToolActivitySummaryActions,
  readToolActivity,
} from '@/lib/mothership/tools/tool-activity'
import { getToolStatusDisplayTitle } from '@/lib/mothership/tools/tool-display'
import { ActivityStream } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-stream'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { getActivityAttentionKey } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
import { isToolDone } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

const MAX_SUMMARY_ACTIONS = 2

function isFailedTool(tool: ToolCallData): boolean {
  return tool.status === ToolCallStatus.error || tool.status === ToolCallStatus.rejected
}

function toolCountLabel(tools: ToolCallData[]): string {
  return `${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`
}

/** Summarize completed actions without describing failed or skipped work as successful. */
export function getToolActivitySummary(tools: ToolCallData[]): string {
  if (tools.length === 1) {
    const tool = tools[0]
    if (isFailedTool(tool)) return toolCountLabel(tools)
    return getToolStatusDisplayTitle(
      tool.displayTitle,
      tool.status,
      tool.toolName,
      tool.activityDescription
    )
  }
  const { labels, additionalActions } = getToolActivitySummaryActions(
    tools.filter((tool) => tool.status === ToolCallStatus.success),
    MAX_SUMMARY_ACTIONS
  )
  const summary = labels.join(', ')
  const summaryLabel = summary ? summary[0].toUpperCase() + summary.slice(1) : toolCountLabel(tools)
  return [
    additionalActions > 0 ? `${summaryLabel} +${additionalActions} more` : summaryLabel,
    ...getToolActivityOutcomes(tools),
  ].join(' · ')
}

function getToolActivityOutcomes(tools: ToolCallData[]): string[] {
  let stopped = 0
  let skipped = 0
  for (const tool of tools) {
    if (tool.status === ToolCallStatus.cancelled || tool.status === ToolCallStatus.interrupted)
      stopped++
    else if (tool.status === ToolCallStatus.skipped) skipped++
  }
  return [...(stopped ? [`${stopped} stopped`] : []), ...(skipped ? [`${skipped} skipped`] : [])]
}

/** Failed attempts belong in the expanded history, not the activity summary. */
export function getActiveToolActivityTitle(
  label: string,
  tool: ToolCallData,
  tools: ToolCallData[]
): string {
  if (isFailedTool(tool)) return toolCountLabel(tools)
  return tool.status === ToolCallStatus.executing || tool.status === ToolCallStatus.success
    ? [label, ...getToolActivityOutcomes(tools)].join(' · ')
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
      .find((entry) => entry?.completedTitle)
  const running = tools.filter((tool) => !isToolDone(tool.status))
  const working = running.length > 0
  const complete = !isActive && !working
  const headerActive = working && statusTool.status !== ToolCallStatus.awaiting_approval
  const attentionKey = getActivityAttentionKey(tools)
  const activityTools =
    completedGroupCount > 1 && groupedActivity
      ? tools.filter(
          (tool) => readToolActivity(tool.params, tool.streamingArgs)?.id === groupedActivity.id
        )
      : tools
  const failedActivityTool = activityTools.find(
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
    ? [
        `${completedActivityLabel}${completedGroupCount > 1 ? ` + ${completedGroupCount - 1}` : ''}`,
        ...getToolActivityOutcomes(tools.filter((tool) => !activityTools.includes(tool))),
      ].join(' · ')
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
            label: working
              ? getActiveToolActivityTitle(
                  `${generatingCall ? 'Working…' : status.label}${running.length > 1 ? ` + ${running.length - 1}` : ''}`,
                  statusTool,
                  tools
                )
              : complete
                ? (completedLabel ??
                  getActiveToolActivityTitle(
                    `${status.label}${tools.length > 1 ? ` + ${tools.length - 1}` : ''}`,
                    statusTool,
                    tools
                  ))
                : getActiveToolActivityTitle(status.label, statusTool, tools),
            isActive: headerActive,
          }}
          activityKey={statusTool.id}
          attentionKey={attentionKey}
          collapsible={tools.length > 1 || isFailedTool(statusTool)}
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
