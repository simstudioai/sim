import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/** All Twilio SMS trigger IDs, used to share auth fields across both triggers. */
export const TWILIO_SMS_TRIGGER_IDS = ['twilio_sms_received', 'twilio_sms_status'] as const

export const twilioSmsTriggerOptions = [
  { label: 'SMS Received', id: 'twilio_sms_received' },
  { label: 'Message Status', id: 'twilio_sms_status' },
]

/**
 * Shared Account SID + Auth Token fields. Rendered only by the primary trigger
 * (with a condition covering both trigger IDs) so the fields are not duplicated
 * when both triggers' subBlocks are spread into the block.
 */
export function buildTwilioSmsAuthFields(): SubBlockConfig[] {
  const condition = {
    field: 'selectedTriggerId',
    value: [...TWILIO_SMS_TRIGGER_IDS],
  }
  return [
    {
      id: 'accountSid',
      title: 'Twilio Account SID',
      type: 'short-input',
      placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      description: 'Your Twilio Account SID from the Twilio Console',
      required: true,
      mode: 'trigger',
      condition,
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      placeholder: 'Your Twilio Auth Token',
      description: 'Your Twilio Auth Token, used to verify the X-Twilio-Signature header',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition,
    },
  ]
}

function renderInstructions(steps: string[]): string {
  return steps
    .map((step, index) => `<div class="mb-3"><strong>${index + 1}.</strong> ${step}</div>`)
    .join('')
}

export function twilioSmsReceivedInstructions(): string {
  return renderInstructions([
    'Copy the <strong>Webhook URL</strong> above.',
    'Enter your <strong>Account SID</strong> and <strong>Auth Token</strong> above so Sim can verify the <code>X-Twilio-Signature</code> on every request.',
    'Go to your <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener noreferrer">Twilio Console Phone Numbers page</a> and select the number that will receive messages (or open <a href="https://console.twilio.com/us1/develop/sms/services" target="_blank" rel="noopener noreferrer">Messaging Services</a> if you use one).',
    'In the <strong>Messaging Configuration</strong> section, set <strong>"A MESSAGE COMES IN"</strong> to <strong>Webhook</strong> and paste the Webhook URL.',
    'Ensure the HTTP method is set to <strong>POST</strong>.',
    'Save your changes in the Twilio Console, then click "Save" above to activate your trigger.',
  ])
}

export function twilioSmsStatusInstructions(): string {
  return renderInstructions([
    'Copy the <strong>Webhook URL</strong> above — this is your <strong>Status Callback URL</strong>.',
    'Enter your <strong>Account SID</strong> and <strong>Auth Token</strong> above so Sim can verify the <code>X-Twilio-Signature</code> on every request.',
    'Set the Status Callback URL where your outbound messages are sent from: pass <code>StatusCallback</code> when sending via the API, set the <strong>Status Callback URL</strong> on your <a href="https://console.twilio.com/us1/develop/sms/services" target="_blank" rel="noopener noreferrer">Messaging Service</a>, or set it on your phone number.',
    'Twilio will POST a request to this URL each time a message status changes (sent, delivered, undelivered, failed).',
    'Ensure the HTTP method is set to <strong>POST</strong>.',
    'Save your changes in the Twilio Console, then click "Save" above to activate your trigger.',
  ])
}

/**
 * Trigger outputs for Twilio SMS webhooks. Shared by both the inbound-message
 * and status-callback triggers. Keys MUST stay aligned with the `formatInput`
 * implementation in `apps/sim/lib/webhooks/providers/twilio.ts`.
 * @see https://www.twilio.com/docs/messaging/guides/webhook-request
 * @see https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
 */
export function buildTwilioSmsOutputs(): Record<string, TriggerOutput> {
  return {
    messageSid: {
      type: 'string',
      description: 'Unique 34-character identifier for the message',
    },
    accountSid: {
      type: 'string',
      description: 'Twilio Account SID',
    },
    messagingServiceSid: {
      type: 'string',
      description: 'Messaging Service SID, if the message was sent through one',
    },
    from: {
      type: 'string',
      description: 'Phone number or channel address that sent the message (E.164 format)',
    },
    to: {
      type: 'string',
      description: 'Phone number or channel address of the recipient (E.164 format)',
    },
    body: {
      type: 'string',
      description: 'Text body of the message (up to 1600 characters)',
    },
    numMedia: {
      type: 'string',
      description: 'Number of media items attached to the message',
    },
    numSegments: {
      type: 'string',
      description: 'Number of segments that make up the message',
    },
    media: {
      type: 'json',
      description: 'Array of attached media as { url, contentType } objects (MMS)',
    },
    smsStatus: {
      type: 'string',
      description: 'SMS status (e.g., received, sent, delivered, undelivered, failed)',
    },
    messageStatus: {
      type: 'string',
      description: 'Message status for status callbacks (sent, delivered, undelivered, failed)',
    },
    errorCode: {
      type: 'string',
      description: 'Twilio error code, present when the status is failed or undelivered',
    },
    apiVersion: {
      type: 'string',
      description: 'Twilio API version used to process the message',
    },
    fromCity: {
      type: 'string',
      description: 'City of the sender, when available',
    },
    fromState: {
      type: 'string',
      description: 'State/province of the sender, when available',
    },
    fromZip: {
      type: 'string',
      description: 'Zip/postal code of the sender, when available',
    },
    fromCountry: {
      type: 'string',
      description: 'Country of the sender, when available',
    },
    toCity: {
      type: 'string',
      description: 'City of the recipient, when available',
    },
    toState: {
      type: 'string',
      description: 'State/province of the recipient, when available',
    },
    toZip: {
      type: 'string',
      description: 'Zip/postal code of the recipient, when available',
    },
    toCountry: {
      type: 'string',
      description: 'Country of the recipient, when available',
    },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Twilio as a JSON string',
    },
  }
}
