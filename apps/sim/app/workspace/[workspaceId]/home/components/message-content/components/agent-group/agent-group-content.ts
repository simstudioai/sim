import type {
  AgentGroupItem,
  NestedAgentGroup,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { isToolDone } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

/**
 * The newest call that is still in progress, by start time, so parallel calls
 * hand the live indicator to whichever began last and back as each finishes.
 */
export function getNewestRunningTool(tools: ToolCallData[]): ToolCallData | undefined {
  return tools.reduce<ToolCallData | undefined>(
    (newest, tool) =>
      !isToolDone(tool.status) && (!newest || (tool.startedAt ?? 0) >= (newest.startedAt ?? 0))
        ? tool
        : newest,
    undefined
  )
}

/** Empty agent lanes share the turn's thinking indicator until they have output. */
export function hasAgentGroupItemContent(item: AgentGroupItem): boolean {
  switch (item.type) {
    case 'tool':
      return true
    case 'text':
      return item.content.trim().length > 0
    case 'agent_group':
      return Boolean(item.group.error) || item.group.items.some(hasAgentGroupItemContent)
  }
}

/** Finds empty live lanes at any depth whose wait belongs to the turn indicator. */
export function hasPendingAgentGroup(
  group: Pick<NestedAgentGroup, 'items' | 'isOpen' | 'isDelegating'>
): boolean {
  return (
    ((group.isOpen || group.isDelegating) && !group.items.some(hasAgentGroupItemContent)) ||
    group.items.some((item) => item.type === 'agent_group' && hasPendingAgentGroup(item.group))
  )
}

/**
 * Every tool in a group, in stream order, including those run by nested
 * agents. A parent's status line speaks for the whole subtree it delegated,
 * so a grandchild's work is what surfaces while the parent itself waits.
 */
export function collectGroupTools(items: AgentGroupItem[]): ToolCallData[] {
  const tools: ToolCallData[] = []
  const walk = (list: AgentGroupItem[]) => {
    for (const item of list) {
      if (item.type === 'tool') tools.push(item.data)
      else if (item.type === 'agent_group') walk(item.group.items)
    }
  }
  walk(items)
  return tools
}

/** Every call in the lane, nested lanes included, has finished, and there was work to finish. */
export function isAgentGroupResolved(items: AgentGroupItem[]): boolean {
  let hasWork = false
  for (const item of items) {
    if (item.type === 'tool') {
      hasWork = true
      if (!isToolDone(item.data.status)) return false
    } else if (item.type === 'agent_group') {
      hasWork = true
      if (item.group.isDelegating || !isAgentGroupResolved(item.group.items)) return false
    }
  }
  return hasWork
}
