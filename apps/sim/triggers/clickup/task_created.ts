import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpTaskOutputs, clickupTriggerOptions } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupTaskCreatedTrigger: TriggerConfig = {
  id: 'clickup_task_created',
  name: 'ClickUp Task Created',
  provider: 'clickup',
  description: 'Trigger workflow when a task is created in ClickUp',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: clickupTriggerOptions,
      value: () => 'clickup_task_created',
      required: true,
    },
    ...buildClickUpTriggerSubBlocks('clickup_task_created'),
  ],
  outputs: buildClickUpTaskOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
