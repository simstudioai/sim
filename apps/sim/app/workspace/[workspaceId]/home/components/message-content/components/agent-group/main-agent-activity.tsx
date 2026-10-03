import { type ComponentType, Fragment, type ReactNode } from 'react'
import { omit } from '@sim/utils/object'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import { isAgentGroupResolved } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { splitMainLane } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/lane-activity'
import { ToolActivityGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'

interface MainAgentActivityProps {
  activity?: ToolActivity
  items: AgentGroupItem[]
  ToolCallComponent: ComponentType<ToolCallItemProps>
  renderItem: (item: AgentGroupItem, index: number) => ReactNode
  autoScrollActivity: boolean
  /** The call holding the main lane's live indicator; only the run containing it shimmers. */
  liveToolId?: string
}

/**
 * The main lane's runs and interaction cards;
 * which run is live is decided by the lane, never by a run's position.
 * A run reads the activity's completed title only once every call of the
 * activity has finished, so a finished run before a pending approval or
 * handoff never claims the whole activity is done.
 */
export function MainAgentActivity({
  activity: groupActivity,
  items,
  ToolCallComponent,
  renderItem,
  autoScrollActivity,
  liveToolId,
}: MainAgentActivityProps) {
  const entries = splitMainLane(items)
  const runActivity =
    groupActivity && !isAgentGroupResolved(items)
      ? omit(groupActivity, ['completedTitle'])
      : groupActivity
  const activity = entries.map((entry) => {
    if (entry.type === 'item') {
      return (
        <Fragment key={entry.item.type === 'tool' ? entry.item.data.id : `item-${entry.index}`}>
          {renderItem(entry.item, entry.index)}
        </Fragment>
      )
    }
    const { tools } = entry.run
    return (
      <ToolActivityGroup
        key={tools[0].id}
        tools={tools}
        activity={runActivity}
        isLive={tools.some((tool) => tool.id === liveToolId)}
        ToolCallComponent={ToolCallComponent}
        autoScrollActivity={autoScrollActivity}
      />
    )
  })

  return (
    <div className='flex min-w-0 flex-col gap-2 [&>*:has(+[data-interaction-card])]:mb-2 [&>[data-interaction-card]:not(:last-child)]:mb-2'>
      {activity}
    </div>
  )
}
