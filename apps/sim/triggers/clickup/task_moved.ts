import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpTaskOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupTaskMovedTrigger: TriggerConfig = {
  id: 'clickup_task_moved',
  name: 'ClickUp Task Moved',
  provider: 'clickup',
  description: 'Trigger workflow when a task is moved to a different list in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_task_moved'),
  outputs: buildClickUpTaskOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
