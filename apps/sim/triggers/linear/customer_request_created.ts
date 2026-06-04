import { LinearIcon } from '@/components/icons'
import {
  buildCustomerRequestOutputs,
  buildLinearV2SubBlocks,
  linearSetupInstructions,
} from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

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
      hideFromPreview: true,
      type: 'text',
      defaultValue: linearSetupInstructions('Customer Requests'),
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

export const linearCustomerRequestCreatedV2Trigger: TriggerConfig = {
  id: 'linear_customer_request_created_v2',
  name: 'Linear Customer Request Created',
  provider: 'linear',
  description: 'Trigger workflow when a new customer request is created in Linear',
  version: '2.0.0',
  icon: LinearIcon,
  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_customer_request_created_v2',
    eventType: 'Customer Requests',
  }),
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
