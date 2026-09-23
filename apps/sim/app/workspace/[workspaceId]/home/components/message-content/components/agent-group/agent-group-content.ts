import type {
  AgentGroupItem,
  NestedAgentGroup,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

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
