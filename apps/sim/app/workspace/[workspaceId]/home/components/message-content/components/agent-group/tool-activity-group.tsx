'use client'

import { type ComponentType, Fragment, useState } from 'react'
import { ActivityStatus } from '@/components/ui/activity-status'
import { getToolActivityLabel } from '@/lib/copilot/tools/tool-activity'
import { getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import { ActivityDisclosure } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-disclosure'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { getToolIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

const MAX_SUMMARY_ACTIONS = 2

/** Summarize completed actions without describing failed or skipped work as successful. */
export function getToolActivitySummary(tools: ToolCallData[]): string {
  if (tools.length === 1) {
    const tool = tools[0]
    return getToolStatusDisplayTitle(tool.displayTitle, tool.status, tool.toolName)
  }
  const labels = new Set<string>()
  let failed = 0
  let stopped = 0
  let skipped = 0
  for (const tool of tools) {
    if (tool.status === ToolCallStatus.success) {
      labels.add(getToolActivityLabel(tool.toolName, tool.params))
    } else if (tool.status === ToolCallStatus.error || tool.status === ToolCallStatus.rejected)
      failed++
    else if (tool.status === ToolCallStatus.cancelled || tool.status === ToolCallStatus.interrupted)
      stopped++
    else if (tool.status === ToolCallStatus.skipped) skipped++
  }
  const summary = Array.from(labels).slice(0, MAX_SUMMARY_ACTIONS).join(', ')
  const summaryLabel = summary ? summary[0].toUpperCase() + summary.slice(1) : 'Tool activity'
  const additionalActions = Math.max(0, labels.size - MAX_SUMMARY_ACTIONS)
  const outcomes = [
    failed && `${failed} failed`,
    stopped && `${stopped} stopped`,
    skipped && `${skipped} skipped`,
  ].filter(Boolean)
  return [
    additionalActions > 0 ? `${summaryLabel} +${additionalActions} more` : summaryLabel,
    ...outcomes,
  ].join(' · ')
}

interface ToolActivityGroupProps {
  tools: ToolCallData[]
  ToolCallComponent: ComponentType<ToolCallItemProps>
  autoScrollActivity?: boolean
}

export function ToolActivityGroup({
  tools,
  ToolCallComponent,
  autoScrollActivity = true,
}: ToolActivityGroupProps) {
  const [expanded, setExpanded] = useState(false)
  let activeTool: ToolCallData | undefined
  for (let index = tools.length - 1; index >= 0; index--) {
    if (tools[index].status === ToolCallStatus.executing) {
      activeTool = tools[index]
      break
    }
  }
  const statusTool = activeTool ?? tools[tools.length - 1]
  const SummaryIcon = getToolIcon(tools[0].toolName)

  return (
    <ToolCallComponent
      {...statusTool}
      toolCallId={statusTool.id}
      renderStatus={(status) => {
        if (tools.length === 1) return status
        return (
          <ActivityDisclosure
            header={
              activeTool ? (
                status
              ) : (
                <ActivityStatus
                  label={getToolActivitySummary(tools)}
                  isActive={false}
                  icon={<SummaryIcon className='size-full' />}
                />
              )
            }
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            isStreaming={Boolean(activeTool) && autoScrollActivity}
          >
            <div className='flex min-w-0 flex-col gap-1.5 py-0.5 pl-6'>
              {tools.map((tool) => (
                <Fragment key={tool.id}>
                  {tool.id === statusTool.id ? (
                    status
                  ) : (
                    <ToolCallComponent {...tool} toolCallId={tool.id} />
                  )}
                </Fragment>
              ))}
            </div>
          </ActivityDisclosure>
        )
      }}
    />
  )
}
