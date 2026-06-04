import { LinearIcon } from '@/components/icons'
import {
  buildIssueOutputs,
  buildLinearV2SubBlocks,
  linearSetupInstructions,
  linearTriggerOptions,
} from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearIssueCreatedTrigger: TriggerConfig = {
  id: 'linear_issue_created',
  name: 'Linear Issue Created',
  provider: 'linear',
  description: 'Trigger workflow when a new issue is created in Linear',
  version: '1.0.0',
  icon: LinearIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: linearTriggerOptions,
      value: () => 'linear_issue_created',
      required: true,
    },
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
        value: 'linear_issue_created',
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
        value: 'linear_issue_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: linearSetupInstructions('Issue (create)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_issue_created',
      },
    },
  ],

  outputs: buildIssueOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Issue',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}

export const linearIssueCreatedV2Trigger: TriggerConfig = {
  id: 'linear_issue_created_v2',
  name: 'Linear Issue Created',
  provider: 'linear',
  description: 'Trigger workflow when a new issue is created in Linear',
  version: '2.0.0',
  icon: LinearIcon,
  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_issue_created_v2',
    eventType: 'Issue (create)',
    includeDropdown: true,
  }),
  outputs: buildIssueOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Issue',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
