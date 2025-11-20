import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, linearSetupInstructions } from './utils'

export const linearIssueRemovedTrigger: TriggerConfig = {
  id: 'linear_issue_removed',
  name: 'Linear Issue Removed',
  provider: 'linear',
  description: 'Trigger workflow when an issue is removed/deleted in Linear',
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
        value: 'linear_issue_removed',
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
        value: 'linear_issue_removed',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: linearSetupInstructions('Issue (remove)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_issue_removed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'linear_issue_removed',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_issue_removed',
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
