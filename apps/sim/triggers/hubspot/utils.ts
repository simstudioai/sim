import type { TriggerOutput } from '@/triggers/types'

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
 * Build output schema for contact creation events
 */
export function buildContactCreatedOutputs(): Record<string, TriggerOutput> {
  return {
    eventId: {
      type: 'string',
      description: 'Unique ID for this webhook event',
    },
    subscriptionId: {
      type: 'string',
      description: 'ID of the webhook subscription',
    },
    portalId: {
      type: 'string',
      description: 'HubSpot portal (account) ID',
    },
    occurredAt: {
      type: 'string',
      description: 'Timestamp when the event occurred (milliseconds)',
    },
    eventType: {
      type: 'string',
      description: 'Event type (contact.creation)',
    },
    attemptNumber: {
      type: 'number',
      description: 'Delivery attempt number for this webhook',
    },
    objectId: {
      type: 'string',
      description: 'ID of the contact that was created',
    },
    changeSource: {
      type: 'string',
      description: 'Source of the change (e.g., CRM, API, IMPORT)',
    },
    changeFlag: {
      type: 'string',
      description: 'Flag indicating the type of change',
    },
    appId: {
      type: 'string',
      description: 'ID of the app that triggered the event',
    },
  } as any
}

/**
 * Build output schema for contact deletion events
 */
export function buildContactDeletedOutputs(): Record<string, TriggerOutput> {
  return {
    eventId: {
      type: 'string',
      description: 'Unique ID for this webhook event',
    },
    subscriptionId: {
      type: 'string',
      description: 'ID of the webhook subscription',
    },
    portalId: {
      type: 'string',
      description: 'HubSpot portal (account) ID',
    },
    occurredAt: {
      type: 'string',
      description: 'Timestamp when the event occurred (milliseconds)',
    },
    eventType: {
      type: 'string',
      description: 'Event type (contact.deletion)',
    },
    attemptNumber: {
      type: 'number',
      description: 'Delivery attempt number for this webhook',
    },
    objectId: {
      type: 'string',
      description: 'ID of the contact that was deleted',
    },
    changeSource: {
      type: 'string',
      description: 'Source of the deletion (e.g., CRM, API)',
    },
    changeFlag: {
      type: 'string',
      description: 'Flag indicating the type of change',
    },
    appId: {
      type: 'string',
      description: 'ID of the app that triggered the event',
    },
  } as any
}

/**
 * Build output schema for contact privacy deletion events
 */
export function buildContactPrivacyDeletedOutputs(): Record<string, TriggerOutput> {
  return {
    eventId: {
      type: 'string',
      description: 'Unique ID for this webhook event',
    },
    subscriptionId: {
      type: 'string',
      description: 'ID of the webhook subscription',
    },
    portalId: {
      type: 'string',
      description: 'HubSpot portal (account) ID',
    },
    occurredAt: {
      type: 'string',
      description: 'Timestamp when the event occurred (milliseconds)',
    },
    eventType: {
      type: 'string',
      description: 'Event type (contact.privacyDeletion)',
    },
    attemptNumber: {
      type: 'number',
      description: 'Delivery attempt number for this webhook',
    },
    objectId: {
      type: 'string',
      description: 'ID of the contact whose data was deleted for privacy compliance',
    },
    changeSource: {
      type: 'string',
      description: 'Source of the privacy deletion (e.g., GDPR request)',
    },
    changeFlag: {
      type: 'string',
      description: 'Flag indicating the type of change',
    },
    appId: {
      type: 'string',
      description: 'ID of the app that triggered the event',
    },
  } as any
}

/**
 * Build output schema for contact property change events
 */
export function buildContactPropertyChangedOutputs(): Record<string, TriggerOutput> {
  return {
    eventId: {
      type: 'string',
      description: 'Unique ID for this webhook event',
    },
    subscriptionId: {
      type: 'string',
      description: 'ID of the webhook subscription',
    },
    portalId: {
      type: 'string',
      description: 'HubSpot portal (account) ID',
    },
    occurredAt: {
      type: 'string',
      description: 'Timestamp when the event occurred (milliseconds)',
    },
    eventType: {
      type: 'string',
      description: 'Event type (contact.propertyChange)',
    },
    attemptNumber: {
      type: 'number',
      description: 'Delivery attempt number for this webhook',
    },
    objectId: {
      type: 'string',
      description: 'ID of the contact whose property changed',
    },
    propertyName: {
      type: 'string',
      description: 'Name of the property that changed',
    },
    propertyValue: {
      type: 'string',
      description: 'New value of the property',
    },
    changeSource: {
      type: 'string',
      description: 'Source of the change (e.g., CRM, API, IMPORT, WORKFLOW)',
    },
    sourceId: {
      type: 'string',
      description: 'ID of the source that made the change (e.g., workflow ID, user ID)',
    },
    changeFlag: {
      type: 'string',
      description: 'Flag indicating the type of change',
    },
    appId: {
      type: 'string',
      description: 'ID of the app that triggered the event',
    },
  } as any
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
  }

  const expectedEventType = eventMap[triggerId]
  if (!expectedEventType) {
    return true // Unknown trigger, allow through
  }

  return expectedEventType === eventType
}
