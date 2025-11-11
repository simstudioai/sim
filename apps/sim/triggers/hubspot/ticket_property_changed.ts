import { HubspotIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildTicketPropertyChangedOutputs,
  hubspotSetupInstructions,
  hubspotTicketTriggerOptions,
} from './utils'

export const hubspotTicketPropertyChangedTrigger: TriggerConfig = {
  id: 'hubspot_ticket_property_changed',
  name: 'HubSpot Ticket Property Changed',
  provider: 'hubspot',
  description: 'Trigger workflow when any property of a ticket is updated in HubSpot',
  version: '1.0.0',
  icon: HubspotIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: hubspotTicketTriggerOptions,
      value: () => 'hubspot_ticket_property_changed',
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
        value: 'hubspot_ticket_property_changed',
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
        value: 'hubspot_ticket_property_changed',
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
        value: 'hubspot_ticket_property_changed',
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
        value: 'hubspot_ticket_property_changed',
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
        value: 'hubspot_ticket_property_changed',
      },
    },
    {
      id: 'propertyName',
      title: 'Property Name (Optional)',
      type: 'short-input',
      placeholder: 'e.g., hs_pipeline_stage, hs_ticket_priority',
      description:
        'Optional: Filter to only trigger when a specific property changes. Leave empty to trigger on any property change.',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_ticket_property_changed',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: hubspotSetupInstructions(
        'ticket.propertyChange',
        'The webhook will trigger whenever any property of a ticket is updated. You can optionally filter by a specific property name to only receive events for that property. The webhook provides both the property name and new value in the payload.'
      ),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_ticket_property_changed',
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
        value: 'hubspot_ticket_property_changed',
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
    "eventType": "ticket.propertyChange",
    "active": true
  }'`,
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      showCopyButton: true,
      description: 'Run this command to subscribe to ticket property change events',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_ticket_property_changed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'hubspot_ticket_property_changed',
      condition: {
        field: 'selectedTriggerId',
        value: 'hubspot_ticket_property_changed',
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
            eventId: 3181526832,
            subscriptionId: 4629992,
            portalId: 244315265,
            appId: 23608917,
            occurredAt: 1762659213730,
            subscriptionType: 'ticket.propertyChange',
            attemptNumber: 0,
            objectId: 316126906070,
            propertyName: 'hs_pipeline_stage',
            propertyValue: 'closed',
            changeFlag: 'UPDATED',
            changeSource: 'CRM_UI',
            sourceId: 'userId:84916424',
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
        value: 'hubspot_ticket_property_changed',
      },
    },
  ],

  outputs: buildTicketPropertyChangedOutputs(),

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
