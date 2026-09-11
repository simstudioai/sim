import { Terminal as TerminalTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/** A permission decision or terminal handoff must stay reachable while an agent is waiting. */
export function needsToolInput(tool: ToolCallData): boolean {
  return (
    tool.status === ToolCallStatus.awaiting_approval ||
    (tool.status === ToolCallStatus.executing &&
      tool.toolName === TerminalTool.id &&
      tool.params?.operation === 'handoff')
  )
}
