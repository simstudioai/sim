import { type ComponentType, Fragment, type ReactNode } from 'react'
import type { ToolActivity } from '@/lib/mothership/generated/protocol'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { splitMainLane } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/lane-activity'
import { SearchActivity } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/search-activity'
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
  const activity = entries.map((entry) => {
    if (entry.type === 'item') {
      return (
        <Fragment key={entry.item.type === 'tool' ? entry.item.data.id : `item-${entry.index}`}>
          {renderItem(entry.item, entry.index)}
        </Fragment>
      )
    }
    const { tools, isSearch } = entry.run
    return isSearch ? (
      <SearchActivity key={tools[0].id} tools={tools} liveToolId={liveToolId} />
    ) : (
      <ToolActivityGroup
        key={tools[0].id}
        tools={tools}
        activity={groupActivity}
        isLive={tools.some((tool) => tool.id === liveToolId)}
        ToolCallComponent={ToolCallComponent}
        autoScrollActivity={autoScrollActivity}
      />
    )
  })

  return <div className='flex min-w-0 flex-col gap-3'>{activity}</div>
}
