import { Table } from '@sim/emcn-legacy/icons'
import { SlackIcon } from '@/components/icons'
import type {
  ToolActivityPresentation,
  ToolCallItemProps,
} from '@/components/mothership-chat/message-content/components/agent-group/tool-call-item'
import { getToolIcon } from '@/components/mothership-chat/message-content/utils'
import { ActivityStatus } from '@/components/ui/activity-status'
import { getToolInProgressTitle, getToolStatusDisplayTitle } from '@/lib/mothership/tools/display'

/**
 * Demo fixtures have known brands, so the landing page never loads the block registry.
 * Rows are history and never shimmer; the lane decides which header is live.
 */
export function HeroToolCallItem({
  toolCallId,
  renderStatus,
  toolName,
  displayTitle,
  activityDescription,
  status,
}: ToolCallItemProps) {
  const Icon =
    toolCallId === 'hero-read-slack'
      ? SlackIcon
      : toolCallId === 'hero-read-table'
        ? Table
        : getToolIcon(toolName)
  const activity: ToolActivityPresentation = {
    label: getToolStatusDisplayTitle(displayTitle, status, toolName, activityDescription),
    activeLabel: getToolInProgressTitle(displayTitle, status, toolName, activityDescription),
    isActive: false,
    icon: <Icon className='size-full' />,
  }
  return renderStatus ? renderStatus(activity) : <ActivityStatus {...activity} />
}
