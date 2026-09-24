'use client'

import { type ComponentType, Fragment, useState } from 'react'
import { ActivityStatus } from '@/components/ui/activity-status'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import { CallIntegrationTool, RunCode } from '@/lib/mothership/generated/tool-catalog-v1'
import { extractStreamingStringArgument } from '@/lib/mothership/tools/streaming-args'
import {
  getToolActivitySummaryActions,
  readToolActivity,
} from '@/lib/mothership/tools/tool-activity'
import { getToolStatusDisplayTitle } from '@/lib/mothership/tools/tool-display'
import { ActivityStream } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-stream'
import { getNewestRunningTool } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import {
  getActivityAttentionKey,
  needsToolInput,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
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
 * An executing call whose streamed arguments do not name its action yet, so its
 * title is only its tool's placeholder: a `sim_cli` call before its command
 * parses ("Running CLI command") or a `run_code` call before its arguments
 * resolve, while their parameters hold at most the activity, and an
 * integration gateway call before its description streams ("Calling integration").
 * A call awaiting approval is never untitled, so its permission card keeps the header.
 */
function isAwaitingTitle(tool: ToolCallData): boolean {
  if (tool.status !== ToolCallStatus.executing) return false
  if (tool.toolName === CallIntegrationTool.id) {
    const description =
      tool.params?.description ?? extractStreamingStringArgument(tool.streamingArgs, 'description')
    return !(typeof description === 'string' && description.trim())
  }
  return (
    (tool.toolName === 'sim_cli' || tool.toolName === RunCode.id) &&
    Object.keys(tool.params ?? {}).every((key) => key === 'activity')
  )
}

/**
 * The call an in-progress header describes, label and icon alike, shared by
 * tool group and subagent headers so a live header never flips to placeholder
 * text between steps: the status call, unless it is still awaiting its title,
 * in which case the call the header described before it keeps the header
 * until the new title arrives. A call waiting on the user is never held, since
 * its permission card or handoff would replace the header. With no earlier
 * titled call, the status call.
 */
export function getActivityHeaderTool(
  tools: ToolCallData[],
  statusTool: ToolCallData
): ToolCallData {
  if (!isAwaitingTitle(statusTool)) return statusTool
  return (
    getActivityStatusTool(
      tools.filter(
        (tool) => tool.id !== statusTool.id && !isAwaitingTitle(tool) && !needsToolInput(tool)
      )
    ) ?? statusTool
  )
}

/**
 * The title of an activity in progress for its header call, with earlier
 * stops and skips kept visible. A header call still awaiting its title has no
 * earlier call to hold, so it reads as the activity's intent when the model
 * gave one, else as its own in-progress title.
 */
export function getInProgressActivityLabel(
  activeLabel: string,
  headerTool: ToolCallData,
  tools: ToolCallData[],
  activityTitle: string | undefined
): string {
  const label = (isAwaitingTitle(headerTool) && activityTitle) || activeLabel
  return getActiveToolActivityTitle(label, headerTool, tools)
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
  const headerTool = getActivityHeaderTool(tools, statusTool)
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
      {...headerTool}
      toolCallId={headerTool.id}
      renderStatus={(status) => (
        <ActivityStream
          activity={{
            label: working
              ? getInProgressActivityLabel(
                  status.activeLabel,
                  headerTool,
                  tools,
                  groupedActivity?.title
                )
              : tools.length === 1
                ? status.label
                : getCompletedActivityLabel(tools, groupedActivity),
            isActive: isLive,
            icon: status.icon,
          }}
          activityKey={headerTool.id}
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
                {tool.id === headerTool.id ? (
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
