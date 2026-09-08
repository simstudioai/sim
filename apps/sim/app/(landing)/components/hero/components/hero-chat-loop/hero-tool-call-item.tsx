import { Table } from '@sim/emcn/icons'
import { SlackIcon } from '@/components/icons'
import { getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { ToolCallRow } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-row'

/** Demo fixtures have known brands, so the landing page never loads the block registry. */
export function HeroToolCallItem({
  toolCallId,
  toolName,
  displayTitle,
  status,
}: ToolCallItemProps) {
  const Icon =
    toolCallId === 'hero-read-slack'
      ? SlackIcon
      : toolCallId === 'hero-read-table'
        ? Table
        : undefined
  return (
    <ToolCallRow
      title={getToolStatusDisplayTitle(displayTitle, status, toolName)}
      isExecuting={status === 'executing'}
      icon={Icon && <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />}
    />
  )
}
