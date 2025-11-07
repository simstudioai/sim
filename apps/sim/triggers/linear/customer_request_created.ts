import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildCustomerRequestOutputs, linearSetupInstructions } from './utils'

export const linearCustomerRequestCreatedTrigger: TriggerConfig = {
  id: 'linear_customer_request_created',
  name: 'Linear Customer Request Created',
  provider: 'linear',
  description: 'Trigger workflow when a new customer request is created in Linear',
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
        value: 'linear_customer_request_created',
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
        value: 'linear_customer_request_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('Customer Requests'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_customer_request_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_customer_request_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_customer_request_created',
      },
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          action: 'create',
          type: 'CustomerNeed',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730937600000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T12:00:00.000Z',
          actor: {
            id: 'user_123',
            name: 'John Doe',
            type: 'user',
          },
          data: {
            id: 'customer_need_abc123',
            body: 'We need a feature to export data in CSV format',
            priority: 1,
            customerId: 'customer_456',
            issueId: 'issue_789',
            projectId: 'project_567',
            creatorId: 'user_123',
            url: 'https://linear.app/acme/customer-needs/customer_need_abc123',
            createdAt: '2025-11-06T12:00:00.000Z',
            updatedAt: '2025-11-06T12:00:00.000Z',
            archivedAt: null,
          },
        },
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_customer_request_created',
      },
    },
  ],

  outputs: buildCustomerRequestOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'CustomerNeed',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
