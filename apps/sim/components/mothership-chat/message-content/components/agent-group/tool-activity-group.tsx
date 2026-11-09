'use client'

import { type ComponentType, Fragment, useState } from 'react'
import { ActivityStream } from '@/components/mothership-chat/message-content/components/agent-group/activity-stream'
import { getSearchActivitySources } from '@/components/mothership-chat/message-content/components/agent-group/search-activity-details'
import { SearchActivityResults } from '@/components/mothership-chat/message-content/components/agent-group/search-activity-results'
import {
  getActivityHeaderTool,
  getActivityStatusTool,
  getCompletedActivityLabel,
  getInProgressActivityLabel,
  getToolTitle,
  isAwaitingTitle,
  withoutRetriedSearchFailures,
} from '@/components/mothership-chat/message-content/components/agent-group/tool-activity-labels'
import type { ToolCallItemProps } from '@/components/mothership-chat/message-content/components/agent-group/tool-call-item'
import { getActivityAttentionKey } from '@/components/mothership-chat/message-content/components/agent-group/tool-interactions'
import { isToolDone } from '@/components/mothership-chat/message-content/utils'
import { ActivityStatus } from '@/components/ui/activity-status'
import type { ToolCallData } from '@/lib/mothership/chat/types'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import { readCallActivity } from '@/lib/mothership/tools/activity'

export {
  getActivityHeaderTool,
  getActivityStatusTool,
  getCompletedActivityLabel,
  getInProgressActivityLabel,
  isAwaitingTitle,
  THINKING_LABEL,
} from '@/components/mothership-chat/message-content/components/agent-group/tool-activity-labels'

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
  tools: calls,
  ToolCallComponent,
  autoScrollActivity = true,
  isLive = false,
}: ToolActivityGroupProps) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const tools = withoutRetriedSearchFailures(calls)
  const statusTool = getActivityStatusTool(tools)
  if (!statusTool) return null
  const headerTool = getActivityHeaderTool(tools, statusTool)
  const groupedActivity =
    activity ??
    tools
      .map(readCallActivity)
      .reverse()
      .find((entry) => entry?.title || entry?.completedTitle)
  /** Tense follows liveness: a live group, or one with a call still running, reads in progress. */
  const working = isLive || tools.some((tool) => !isToolDone(tool.status))
  const attentionKey = getActivityAttentionKey(tools)
  const entries = tools.map((tool) => ({ tool, sources: getSearchActivitySources(tool) }))
  const hasSearchDetails = entries.some(({ sources }) => sources !== undefined)
  const expanded = manualExpanded ?? (isLive && hasSearchDetails)

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
          placeholder={working && isAwaitingTitle(headerTool)}
          attentionKey={attentionKey}
          expandedLabel={tools.length > 1 ? groupedActivity?.title : undefined}
          collapsible={tools.length > 1 || hasSearchDetails}
          expanded={expanded}
          onToggle={() => setManualExpanded(!expanded)}
          isStreaming={working && autoScrollActivity}
          unbounded={entries.some(({ sources }) => (sources?.length ?? 0) > 0)}
        >
          <div className='flex min-w-0 flex-col gap-2'>
            {entries.map(({ tool, sources }, index) => (
              <Fragment key={tool.id}>
                {tools.length === 1 ? null : tool.id === headerTool.id ? (
                  <ActivityStatus {...status} />
                ) : (
                  <ToolCallComponent {...tool} toolCallId={tool.id} />
                )}
                {sources && (
                  <SearchActivityResults
                    sources={sources}
                    label={`Search results for step ${index + 1}: ${getToolTitle(tool)}`}
                  />
                )}
              </Fragment>
            ))}
          </div>
        </ActivityStream>
      )}
    />
  )
}
