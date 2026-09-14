import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import { type ComponentType, Fragment, type ReactNode } from 'react'
import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/mothership/tools/retired-tools'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { ToolActivityGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { needsToolInput } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
import { isToolDone } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

interface MainAgentActivityProps {
  activity?: ToolActivity
  completedGroupCount?: number
  items: AgentGroupItem[]
  ToolCallComponent: ComponentType<ToolCallItemProps>
  renderItem: (item: AgentGroupItem, index: number) => ReactNode
  autoScrollActivity: boolean
  isActive: boolean
}

/** Keep answers and interactions in the transcript, outside collapsible tool history. */
function isStandaloneItem(item: AgentGroupItem): boolean {
  return (
    item.type !== 'tool' ||
    needsToolInput(item.data) ||
    item.data.toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID
  )
}

export function MainAgentActivity({
  activity: groupActivity,
  completedGroupCount,
  items,
  ToolCallComponent,
  renderItem,
  autoScrollActivity,
  isActive,
}: MainAgentActivityProps) {
  const activity: ReactNode[] = []
  const unresolved = items.some((item) => item.type === 'tool' && !isToolDone(item.data.status))
  let tools: ToolCallData[] = []
  const flushTools = (active = false) => {
    if (tools.length === 0) return
    activity.push(
      <ToolActivityGroup
        key={tools[0].id}
        tools={tools}
        activity={groupActivity}
        completedGroupCount={completedGroupCount}
        isActive={active || unresolved}
        ToolCallComponent={ToolCallComponent}
        autoScrollActivity={autoScrollActivity}
      />
    )
    tools = []
  }

  for (const [index, item] of items.entries()) {
    if (item.type === 'tool' && !isStandaloneItem(item)) {
      tools.push(item.data)
      continue
    }
    flushTools()
    activity.push(
      <Fragment
        key={
          item.type === 'tool'
            ? item.data.id
            : item.type === 'agent_group'
              ? item.group.id
              : `text-${index}`
        }
      >
        {renderItem(item, index)}
      </Fragment>
    )
  }
  flushTools(isActive)

  return <div className='flex min-w-0 flex-col gap-1.5'>{activity}</div>
}
