import { HubspotIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildConversationCreationOutputs,
  hubspotConversationTriggerOptions,
  hubspotSetupInstructions,
} from './utils'

export const hubspotConversationCreationTrigger: TriggerConfig = {
  id: 'hubspot_conversation_creation',
  name: 'HubSpot Conversation Creation',
  provider: 'hubspot',
  description: 'Trigger workflow when a new conversation is created in HubSpot',
  version: '1.0.0',
  icon: HubspotIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: hubspotConversationTriggerOptions,
      value: () => 'hubspot_conversation_creation',
      required: true,
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'Enter your HubSpot app Client ID',
      description: 'Found in your HubSpot app settings under Auth tab',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'clientSecret',
      title: 'Client Secret',
      type: 'short-input',
      placeholder: 'Enter your HubSpot app Client Secret',
      description: 'Found in your HubSpot app settings under Auth tab',
      password: true,
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'appId',
      title: 'App ID',
      type: 'short-input',
      placeholder: 'Enter your HubSpot App ID',
      description: 'Found in your HubSpot app settings. Used to identify your app.',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'developerApiKey',
      title: 'Developer API Key',
      type: 'short-input',
      placeholder: 'Enter your HubSpot Developer API Key',
      description: 'Used for making API calls to HubSpot. Found in your HubSpot app settings.',
      password: true,
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      description: 'Copy this URL and paste it into your HubSpot app webhook subscription settings',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: hubspotSetupInstructions(
        'conversation.creation',
        'The webhook will trigger whenever a new conversation is created in your HubSpot account, such as when a new email thread starts or a chat conversation begins.'
      ),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'curlSetWebhookUrl',
      title: '1. Set Webhook Target URL',
      type: 'code',
      language: 'javascript',
      value: (params: Record<string, any>) => {
        const webhookUrl = params.webhookUrlDisplay || '{YOUR_WEBHOOK_URL_FROM_ABOVE}'
        return `curl -X PUT "https://api.hubapi.com/webhooks/v3/{YOUR_APP_ID}/settings?hapikey={YOUR_DEVELOPER_API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "targetUrl": "${webhookUrl}",
    "throttling": {
      "maxConcurrentRequests": 10
    }
  }'`
      },
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      showCopyButton: true,
      description: 'Run this command to set your webhook URL in HubSpot',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'curlCreateSubscription',
      title: '2. Create Webhook Subscription',
      type: 'code',
      language: 'javascript',
      defaultValue: `curl -X POST "https://api.hubapi.com/webhooks/v3/{YOUR_APP_ID}/subscriptions?hapikey={YOUR_DEVELOPER_API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "eventType": "conversation.creation",
    "active": true
  }'`,
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      showCopyButton: true,
      description: 'Run this command to subscribe to conversation creation events',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'hubspot_conversation_creation',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        [
          {
            eventId: 3181526820,
            subscriptionId: 4629980,
            portalId: 244315265,
            appId: 23608917,
            occurredAt: 1762659213730,
            subscriptionType: 'conversation.creation',
            attemptNumber: 0,
            objectId: 316126906055,
            changeFlag: 'CREATED',
            changeSource: 'EMAIL',
          },
        ],
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_conversation_creation',
      },
    },
  ],

  outputs: buildConversationCreationOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-HubSpot-Signature': 'sha256=...',
      'X-HubSpot-Request-Id': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'User-Agent': 'HubSpot Webhooks',
    },
  },
}
