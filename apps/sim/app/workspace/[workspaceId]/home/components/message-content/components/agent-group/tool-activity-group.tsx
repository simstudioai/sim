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
import { getNewestRunningTool } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { getActivityAttentionKey } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
import { isToolDone } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/** A completed summary names at most this many distinct actions, and never counts the rest. */
const MAX_SUMMARY_ACTIONS = 3

function isFailedTool(tool: ToolCallData): boolean {
  return tool.status === ToolCallStatus.error || tool.status === ToolCallStatus.rejected
}

function toolCountLabel(tools: ToolCallData[]): string {
  return `${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`
}

function getToolTitle(tool: ToolCallData): string {
  return getToolStatusDisplayTitle(
    tool.displayTitle,
    tool.status,
    tool.toolName,
    tool.activityDescription
  )
}

/**
 * Summarize completed actions without describing failed or skipped work as
 * successful: a single call, or the only successful one, keeps its own title;
 * several successful calls name their distinct actions ("Navigated, read
 * pages, clicked elements"); stopped or skipped calls append an outcome count.
 */
function getToolActivitySummary(tools: ToolCallData[]): string {
  if (tools.length === 1) return getToolTitle(tools[0])
  const succeeded = tools.filter((tool) => tool.status === ToolCallStatus.success)
  const [first, ...rest] =
    succeeded.length === 1
      ? [getToolTitle(succeeded[0])]
      : getToolActivitySummaryActions(succeeded, MAX_SUMMARY_ACTIONS)
  const summary = first
    ? [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(', ')
    : toolCountLabel(tools)
  return [summary, ...getToolActivityInterruptions(tools)].join(' · ')
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

/**
 * The title of an activity in progress, shared by tool group and subagent
 * headers: "Working…" while a `sim_cli` or `run_code` call still generates its
 * arguments, else the status call's in-progress title with earlier stops and
 * skips kept visible.
 */
export function getInProgressActivityLabel(
  activeLabel: string,
  statusTool: ToolCallData,
  tools: ToolCallData[]
): string {
  const isGenerating =
    !isToolDone(statusTool.status) &&
    (statusTool.toolName === 'sim_cli' || statusTool.toolName === 'run_code') &&
    Object.keys(statusTool.params ?? {}).every((key) => key === 'activity')
  return isGenerating ? 'Working…' : getActiveToolActivityTitle(activeLabel, statusTool, tools)
}

/** Keep earlier interruptions visible while the latest action continues. */
function getActiveToolActivityTitle(
  label: string,
  tool: ToolCallData,
  tools: ToolCallData[]
): string {
  return tool.status === ToolCallStatus.executing || tool.status === ToolCallStatus.success
    ? [label, ...getToolActivityInterruptions(tools)].join(' · ')
    : label
}

/**
 * The call a header describes: the newest running call, else the latest call
 * that did not error or get rejected, so a failed attempt labels the activity
 * only when every call failed. A stopped, skipped, or interrupted call can still be it.
 */
export function getActivityStatusTool(tools: ToolCallData[]): ToolCallData | undefined {
  return (
    getNewestRunningTool(tools) ??
    tools.filter((tool) => !isFailedTool(tool)).at(-1) ??
    tools.at(-1)
  )
}

/**
 * The label of a finished activity: the model's completed title when every
 * call succeeded, else the summary of what did succeed, so a stopped, skipped,
 * or failed call never hides behind a success title. Main and subagent lanes
 * share this rule.
 */
export function getCompletedActivityLabel(
  tools: ToolCallData[],
  activity: ToolActivity | undefined
): string {
  return activity?.completedTitle && tools.every((tool) => tool.status === ToolCallStatus.success)
    ? activity.completedTitle
    : getToolActivitySummary(tools)
}

interface ToolActivityGroupProps {
  activity?: ToolActivity
  tools: ToolCallData[]
  ToolCallComponent: ComponentType<ToolCallItemProps>
  autoScrollActivity?: boolean
  /** The group holds its lane's one live indicator, so its header shimmers. */
  isLive?: boolean
}

export function ToolActivityGroup({
  activity,
  tools,
  ToolCallComponent,
  autoScrollActivity = true,
  isLive = false,
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
  /** Tense follows liveness: a live group, or one with a call still running, reads in progress. */
  const working = isLive || tools.some((tool) => !isToolDone(tool.status))
  const attentionKey = getActivityAttentionKey(tools)

  return (
    <ToolCallComponent
      {...statusTool}
      toolCallId={statusTool.id}
      renderStatus={(status) => (
        <ActivityStream
          activity={{
            label: working
              ? getInProgressActivityLabel(status.activeLabel, statusTool, tools)
              : tools.length === 1
                ? status.label
                : getCompletedActivityLabel(tools, groupedActivity),
            isActive: isLive,
            icon: status.icon,
          }}
          activityKey={statusTool.id}
          attentionKey={attentionKey}
          expandedLabel={tools.length > 1 ? groupedActivity?.title : undefined}
          collapsible={tools.length > 1}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          isStreaming={working && autoScrollActivity}
        >
          <div className='flex min-w-0 flex-col gap-1.5 py-0.5'>
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
