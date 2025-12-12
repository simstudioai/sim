import type { TriggerOutput } from '@/triggers/types'

/**
 * Combined trigger dropdown options for all HubSpot triggers (for block config)
 */
export const hubspotAllTriggerOptions = [
  { label: 'Contact Created', id: 'hubspot_contact_created' },
  { label: 'Contact Deleted', id: 'hubspot_contact_deleted' },
  { label: 'Contact Privacy Deleted', id: 'hubspot_contact_privacy_deleted' },
  { label: 'Contact Property Changed', id: 'hubspot_contact_property_changed' },
  { label: 'Company Created', id: 'hubspot_company_created' },
  { label: 'Company Deleted', id: 'hubspot_company_deleted' },
  { label: 'Company Property Changed', id: 'hubspot_company_property_changed' },
  { label: 'Conversation Creation', id: 'hubspot_conversation_creation' },
  { label: 'Conversation Deletion', id: 'hubspot_conversation_deletion' },
  { label: 'Conversation New Message', id: 'hubspot_conversation_new_message' },
  { label: 'Conversation Privacy Deletion', id: 'hubspot_conversation_privacy_deletion' },
  { label: 'Conversation Property Changed', id: 'hubspot_conversation_property_changed' },
  { label: 'Deal Created', id: 'hubspot_deal_created' },
  { label: 'Deal Deleted', id: 'hubspot_deal_deleted' },
  { label: 'Deal Property Changed', id: 'hubspot_deal_property_changed' },
  { label: 'Ticket Created', id: 'hubspot_ticket_created' },
  { label: 'Ticket Deleted', id: 'hubspot_ticket_deleted' },
  { label: 'Ticket Property Changed', id: 'hubspot_ticket_property_changed' },
]

/**
 * Shared trigger dropdown options for all HubSpot contact triggers
 */
export const hubspotContactTriggerOptions = [
  { label: 'Contact Created', id: 'hubspot_contact_created' },
  { label: 'Contact Deleted', id: 'hubspot_contact_deleted' },
  { label: 'Contact Privacy Deleted', id: 'hubspot_contact_privacy_deleted' },
  { label: 'Contact Property Changed', id: 'hubspot_contact_property_changed' },
]

/**
 * Shared trigger dropdown options for all HubSpot company triggers
 */
export const hubspotCompanyTriggerOptions = [
  { label: 'Company Created', id: 'hubspot_company_created' },
  { label: 'Company Deleted', id: 'hubspot_company_deleted' },
  { label: 'Company Property Changed', id: 'hubspot_company_property_changed' },
]

/**
 * Shared trigger dropdown options for all HubSpot conversation triggers
 */
export const hubspotConversationTriggerOptions = [
  { label: 'Conversation Creation', id: 'hubspot_conversation_creation' },
  { label: 'Conversation Deletion', id: 'hubspot_conversation_deletion' },
  { label: 'Conversation New Message', id: 'hubspot_conversation_new_message' },
  { label: 'Conversation Privacy Deletion', id: 'hubspot_conversation_privacy_deletion' },
  { label: 'Conversation Property Changed', id: 'hubspot_conversation_property_changed' },
]

/**
 * Shared trigger dropdown options for all HubSpot deal triggers
 */
export const hubspotDealTriggerOptions = [
  { label: 'Deal Created', id: 'hubspot_deal_created' },
  { label: 'Deal Deleted', id: 'hubspot_deal_deleted' },
  { label: 'Deal Property Changed', id: 'hubspot_deal_property_changed' },
]

/**
 * Shared trigger dropdown options for all HubSpot ticket triggers
 */
export const hubspotTicketTriggerOptions = [
  { label: 'Ticket Created', id: 'hubspot_ticket_created' },
  { label: 'Ticket Deleted', id: 'hubspot_ticket_deleted' },
  { label: 'Ticket Property Changed', id: 'hubspot_ticket_property_changed' },
]

/**
 * Generate setup instructions for a specific HubSpot event type
 */
export function hubspotSetupInstructions(eventType: string, additionalNotes?: string): string {
  const instructions = [
    '<strong>Step 1: Create a HubSpot Developer Account</strong><br/>Sign up for a free developer account at <a href="https://developers.hubspot.com" target="_blank">developers.hubspot.com</a> if you don\'t have one.',
    '<strong>Step 2: Create a Public App via CLI</strong><br/><strong>Note:</strong> HubSpot has deprecated the web UI for creating apps. You must use the HubSpot CLI to create and manage apps. Install the CLI with <code>npm install -g @hubspot/cli</code> and run <code>hs project create</code> to create a new app. See <a href="https://developers.hubspot.com/docs/platform/create-an-app" target="_blank">HubSpot\'s documentation</a> for details.',
    '<strong>Step 3: Configure OAuth Settings</strong><br/>After creating your app via CLI, configure it to add the OAuth Redirect URL: <code>https://www.sim.ai/api/auth/oauth2/callback/hubspot</code>. Then retrieve your <strong>Client ID</strong> and <strong>Client Secret</strong> from your app configuration and enter them in the fields above.',
    "<strong>Step 4: Get App ID and Developer API Key</strong><br/>In your HubSpot developer account, find your <strong>App ID</strong> (shown below your app name) and your <strong>Developer API Key</strong> (in app settings). You'll need both for the next steps.",
    '<strong>Step 5: Set Required Scopes</strong><br/>Configure your app to include the required OAuth scope: <code>crm.objects.contacts.read</code>',
    '<strong>Step 6: Save Configuration in Sim</strong><br/>Click the <strong>"Save Configuration"</strong> button below. This will generate your unique webhook URL.',
    '<strong>Step 7: Configure Webhook in HubSpot via API</strong><br/>After saving above, copy the <strong>Webhook URL</strong> and run the two curl commands below (replace <code>{YOUR_APP_ID}</code>, <code>{YOUR_DEVELOPER_API_KEY}</code>, and <code>{YOUR_WEBHOOK_URL_FROM_ABOVE}</code> with your actual values).',
    "<strong>Step 8: Test Your Webhook</strong><br/>Create or modify a contact in HubSpot to trigger the webhook. Check your workflow execution logs in Sim to verify it's working.",
  ]

  if (additionalNotes) {
    instructions.push(`<strong>Additional Info:</strong> ${additionalNotes}`)
  }

  return instructions.map((instruction, index) => `<div class="mb-3">${instruction}</div>`).join('')
}

/**
 * Base webhook outputs that are common to all HubSpot triggers
 * Clean structure with payload, provider, and providerConfig at root level
 */
function buildBaseHubSpotOutputs(): Record<string, TriggerOutput> {
  return {
    payload: {
      type: 'json',
      description: 'Full webhook payload array from HubSpot containing event details',
    },
    provider: {
      type: 'string',
      description: 'Provider name (hubspot)',
    },
    providerConfig: {
      appId: {
        type: 'string',
        description: 'HubSpot App ID',
      },
      clientId: {
        type: 'string',
        description: 'HubSpot Client ID',
      },
      triggerId: {
        type: 'string',
        description: 'Trigger ID (e.g., hubspot_company_created)',
      },
      clientSecret: {
        type: 'string',
        description: 'HubSpot Client Secret',
      },
      developerApiKey: {
        type: 'string',
        description: 'HubSpot Developer API Key',
      },
      curlSetWebhookUrl: {
        type: 'string',
        description: 'curl command to set webhook URL',
      },
      curlCreateSubscription: {
        type: 'string',
        description: 'curl command to create subscription',
      },
      webhookUrlDisplay: {
        type: 'string',
        description: 'Webhook URL display value',
      },
      propertyName: {
        type: 'string',
        description: 'Optional property name filter (for property change triggers)',
      },
    },
  } as any
}

/**
 * Build output schema for contact creation events
 */
export function buildContactCreatedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for contact deletion events
 */
export function buildContactDeletedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for contact privacy deletion events
 */
export function buildContactPrivacyDeletedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for contact property change events
 */
export function buildContactPropertyChangedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for company creation events
 */
export function buildCompanyCreatedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for company deletion events
 */
export function buildCompanyDeletedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for company property change events
 */
export function buildCompanyPropertyChangedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for conversation creation events
 */
export function buildConversationCreationOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for conversation deletion events
 */
export function buildConversationDeletionOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for conversation new message events
 */
export function buildConversationNewMessageOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for conversation privacy deletion events
 */
export function buildConversationPrivacyDeletionOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for conversation property change events
 */
export function buildConversationPropertyChangedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for deal creation events
 */
export function buildDealCreatedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for deal deletion events
 */
export function buildDealDeletedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for deal property change events
 */
export function buildDealPropertyChangedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for ticket creation events
 */
export function buildTicketCreatedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for ticket deletion events
 */
export function buildTicketDeletedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Build output schema for ticket property change events
 */
export function buildTicketPropertyChangedOutputs(): Record<string, TriggerOutput> {
  return buildBaseHubSpotOutputs()
}

/**
 * Check if a HubSpot event matches the expected trigger configuration
 */
export function isHubSpotContactEventMatch(triggerId: string, eventType: string): boolean {
  const eventMap: Record<string, string> = {
    hubspot_contact_created: 'contact.creation',
    hubspot_contact_deleted: 'contact.deletion',
    hubspot_contact_privacy_deleted: 'contact.privacyDeletion',
    hubspot_contact_property_changed: 'contact.propertyChange',
    hubspot_company_created: 'company.creation',
    hubspot_company_deleted: 'company.deletion',
    hubspot_company_property_changed: 'company.propertyChange',
    hubspot_conversation_creation: 'conversation.creation',
    hubspot_conversation_deletion: 'conversation.deletion',
    hubspot_conversation_new_message: 'conversation.newMessage',
    hubspot_conversation_privacy_deletion: 'conversation.privacyDeletion',
    hubspot_conversation_property_changed: 'conversation.propertyChange',
    hubspot_deal_created: 'deal.creation',
    hubspot_deal_deleted: 'deal.deletion',
    hubspot_deal_property_changed: 'deal.propertyChange',
    hubspot_ticket_created: 'ticket.creation',
    hubspot_ticket_deleted: 'ticket.deletion',
    hubspot_ticket_property_changed: 'ticket.propertyChange',
  }

  const expectedEventType = eventMap[triggerId]
  if (!expectedEventType) {
    return true // Unknown trigger, allow through
  }

  return expectedEventType === eventType
}
