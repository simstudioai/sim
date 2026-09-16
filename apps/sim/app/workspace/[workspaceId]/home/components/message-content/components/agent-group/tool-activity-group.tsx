'use client'

import { type ComponentType, Fragment, useState } from 'react'
import { ActivityStatus } from '@/components/ui/activity-status'
import { getToolActivitySummaryActions } from '@/lib/copilot/tools/tool-activity'
import { getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import { ActivityStream } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-stream'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { getActivityAttentionKey } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
import { getToolIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

const MAX_SUMMARY_ACTIONS = 3

/** Summarize completed actions without describing failed or skipped work as successful. */
export function getToolActivitySummary(tools: ToolCallData[]): string {
  if (tools.length === 1) {
    const tool = tools[0]
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
  const summaryLabel = summary ? summary[0].toUpperCase() + summary.slice(1) : 'Tool activity'
  return [
    additionalActions > 0 ? `${summaryLabel} +${additionalActions} more` : summaryLabel,
    ...getToolActivityInterruptions(tools),
  ].join(' · ')
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
        tool.status === ToolCallStatus.executing &&
        (!newest || (tool.startedAt ?? 0) >= (newest.startedAt ?? 0))
          ? tool
          : newest,
      undefined
    ) ?? tools.at(-1)
  )
}

interface ToolActivityGroupProps {
  tools: ToolCallData[]
  ToolCallComponent: ComponentType<ToolCallItemProps>
  autoScrollActivity?: boolean
  isActive?: boolean
}

export function ToolActivityGroup({
  tools,
  ToolCallComponent,
  autoScrollActivity = true,
  isActive = false,
}: ToolActivityGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const statusTool = getActivityStatusTool(tools)
  if (!statusTool) return null
  const working = isActive || tools.some((tool) => tool.status === ToolCallStatus.executing)
  const headerActive =
    working &&
    (statusTool.status === ToolCallStatus.executing || statusTool.status === ToolCallStatus.success)
  const attentionKey = getActivityAttentionKey(tools)
  const SummaryIcon = getToolIcon(tools[0].toolName)

  return (
    <ToolCallComponent
      {...statusTool}
      toolCallId={statusTool.id}
      renderStatus={(status) => (
        <ActivityStream
          activity={{
            label: working
              ? getActiveToolActivityTitle(status.activeLabel, statusTool, tools)
              : tools.length === 1
                ? status.label
                : getToolActivitySummary(tools),
            isActive: headerActive,
            icon:
              working || tools.length === 1 ? status.icon : <SummaryIcon className='size-full' />,
          }}
          activityKey={statusTool.id}
          attentionKey={attentionKey}
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
