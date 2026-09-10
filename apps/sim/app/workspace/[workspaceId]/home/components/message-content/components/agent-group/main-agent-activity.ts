import { Terminal as TerminalTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/copilot/tools/retired-tools'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

export function getLatestToolId(items: AgentGroupItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.type === 'tool') return item.data.id
  }
}

/** Keep interaction controls and answers when a newer tool replaces the activity text. */
export function getVisibleMainAgentItems(
  items: AgentGroupItem[],
  latestToolId = getLatestToolId(items)
): AgentGroupItem[] {
  return items.filter(
    (item) =>
      item.type !== 'tool' ||
      item.data.id === latestToolId ||
      item.data.status === ToolCallStatus.awaiting_approval ||
      (item.data.toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID &&
        item.data.status === ToolCallStatus.success) ||
      (item.data.status === ToolCallStatus.executing &&
        item.data.toolName === TerminalTool.id &&
        item.data.params?.operation === 'handoff')
  )
}
