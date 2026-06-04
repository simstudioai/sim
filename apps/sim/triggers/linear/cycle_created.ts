import { LinearIcon } from '@/components/icons'
import {
  buildCycleOutputs,
  buildLinearV2SubBlocks,
  linearSetupInstructions,
} from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearCycleCreatedTrigger: TriggerConfig = {
  id: 'linear_cycle_created',
  name: 'Linear Cycle Created',
  provider: 'linear',
  description: 'Trigger workflow when a new cycle is created in Linear',
  version: '1.0.0',
  icon: LinearIcon,

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_cycle_created',
      },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a strong secret',
      description: 'Validates that webhook deliveries originate from Linear.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_cycle_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: linearSetupInstructions('Cycle (create)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_cycle_created',
      },
    },
  ],

  outputs: buildCycleOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Cycle',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}

export const linearCycleCreatedV2Trigger: TriggerConfig = {
  id: 'linear_cycle_created_v2',
  name: 'Linear Cycle Created',
  provider: 'linear',
  description: 'Trigger workflow when a new cycle is created in Linear',
  version: '2.0.0',
  icon: LinearIcon,
  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_cycle_created_v2',
    eventType: 'Cycle (create)',
  }),
  outputs: buildCycleOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Cycle',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
