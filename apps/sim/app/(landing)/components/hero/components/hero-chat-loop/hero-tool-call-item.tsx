import { Table } from '@sim/emcn/icons'
import { SlackIcon } from '@/components/icons'
import { ActivityStatus } from '@/components/ui/activity-status'
import { getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import { getToolIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'

/** Demo fixtures have known brands, so the landing page never loads the block registry. */
export function HeroToolCallItem({
  toolCallId,
  renderStatus,
  toolName,
  displayTitle,
  status,
}: ToolCallItemProps) {
  const Icon =
    toolCallId === 'hero-read-slack'
      ? SlackIcon
      : toolCallId === 'hero-read-table'
        ? Table
        : getToolIcon(toolName)
  const activity = (
    <ActivityStatus
      label={getToolStatusDisplayTitle(displayTitle, status, toolName)}
      isActive={status === 'executing'}
      icon={<Icon className='size-full' />}
    />
  )
  return renderStatus ? renderStatus(activity) : activity
}
