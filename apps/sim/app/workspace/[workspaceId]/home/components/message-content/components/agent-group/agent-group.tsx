'use client'

import { useAssistantActionLayout } from '@/components/assistant-actions'
import {
  type AgentGroupItem,
  type AgentGroupProps,
  AgentGroupView,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { ToolCallItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { CredentialDisplay } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

function renderBrowserTakeover(reason: string) {
  return <CredentialDisplay data={[{ type: 'browser_takeover', name: reason }]} />
}

/** Workspace adapter retains permission, handoff, and integration lookup behavior. */
export function AgentGroup(props: AgentGroupProps) {
  const layout = useAssistantActionLayout()
  const lifted: ToolCallData[] = []
  const items = liftNestedActions(
    props.items,
    layout.standaloneToolIds,
    props.agentName !== 'mothership',
    lifted
  )
  return (
    <>
      <AgentGroupView
        {...props}
        {...layout}
        items={items}
        ToolCallComponent={ToolCallItem}
        renderBrowserTakeover={renderBrowserTakeover}
      />
      {lifted.length > 0 && (
        <div className='flex min-w-0 flex-col gap-2'>
          {lifted.map((tool) => (
            <ToolCallItem key={tool.id} {...tool} toolCallId={tool.id} />
          ))}
        </div>
      )}
    </>
  )
}

/** A nested approval or receipt stays outside its agent's collapsible history. */
function liftNestedActions(
  items: AgentGroupItem[],
  ids: ReadonlySet<string>,
  includeOwn: boolean,
  lifted: ToolCallData[]
): AgentGroupItem[] {
  if (!ids.size) return items
  return items.flatMap((item): AgentGroupItem[] => {
    if (item.type === 'tool' && includeOwn && ids.has(item.data.id)) {
      lifted.push(item.data)
      return []
    }
    if (item.type === 'agent_group')
      return [
        {
          ...item,
          group: { ...item.group, items: liftNestedActions(item.group.items, ids, true, lifted) },
        },
      ]
    return [item]
  })
}
