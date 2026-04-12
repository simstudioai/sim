import { WhatsAppIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const whatsappWebhookTrigger: TriggerConfig = {
  id: 'whatsapp_webhook',
  name: 'WhatsApp Webhook',
  provider: 'whatsapp',
  description: 'Trigger workflow from WhatsApp incoming messages and message status webhooks',
  version: '1.0.0',
  icon: WhatsAppIcon,

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
    },
    {
      id: 'verificationToken',
      title: 'Verification Token',
      type: 'short-input',
      placeholder: 'Generate or enter a verification token',
      description:
        "Enter any secure token here. You'll need to provide the same token in your WhatsApp Business Platform dashboard.",
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'appSecret',
      title: 'App Secret',
      type: 'short-input',
      placeholder: 'Paste your Meta app secret',
      description:
        'Required for WhatsApp POST signature verification. Sim uses it to validate the X-Hub-Signature-256 header on every webhook delivery.',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Go to your <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline transition-colors hover:text-muted-foreground/80">Meta App Dashboard</a> and open the app connected to your WhatsApp Business Platform setup. If you used the WhatsApp use case flow, the configuration page may be under <strong>Use cases &gt; Customize &gt; Configuration</strong> instead of <strong>WhatsApp &gt; Configuration</strong>.',
        'If you do not already have an app, create one first and add the WhatsApp product before configuring webhooks.',
        'Click <strong>"Save Configuration"</strong> above before verifying the callback URL so Sim has an active WhatsApp webhook config for this path. If this workflow is already deployed and you change the verification token or app secret, redeploy before re-verifying in Meta.',
        'In <strong>WhatsApp &gt; Configuration</strong>, find the <strong>Webhooks</strong> section and click <strong>Edit</strong>.',
        'Paste the <strong>Webhook URL</strong> above into the "Callback URL" field.',
        'Paste the <strong>Verification Token</strong> into the "Verify token" field.',
        "Copy your app's <strong>App Secret</strong> from <strong>App Settings &gt; Basic</strong> and paste it into the <strong>App Secret</strong> field above so Sim can validate POST signatures.",
        'Click "Verify and save".',
        'Click <strong>Manage</strong> next to webhook fields and subscribe to <code>messages</code>. That field covers incoming messages and outbound message status updates.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    eventType: {
      type: 'string',
      description: 'Webhook classification such as incoming_message, message_status, or mixed',
    },
    messageId: {
      type: 'string',
      description: 'First WhatsApp message identifier (wamid) found in the webhook batch',
    },
    from: {
      type: 'string',
      description: 'Sender phone number from the first incoming message in the batch',
    },
    recipientId: {
      type: 'string',
      description: 'Recipient phone number from the first status update in the batch',
    },
    phoneNumberId: {
      type: 'string',
      description: 'Business phone number ID from the first message or status item in the batch',
    },
    displayPhoneNumber: {
      type: 'string',
      description:
        'Business display phone number from the first message or status item in the batch',
    },
    text: {
      type: 'string',
      description: 'Text body from the first incoming text message in the batch',
    },
    timestamp: {
      type: 'string',
      description: 'Timestamp from the first message or status item in the batch',
    },
    messageType: {
      type: 'string',
      description: 'Type of the first incoming message in the batch (text, image, system, etc.)',
    },
    status: {
      type: 'string',
      description:
        'First outgoing message status in the batch, such as sent, delivered, read, or failed',
    },
    contact: {
      type: 'json',
      description: 'First sender contact in the batch (wa_id, profile.name)',
    },
    webhookContacts: {
      type: 'json',
      description: 'All sender contact profiles from the webhook batch',
    },
    messages: {
      type: 'json',
      description:
        'All incoming message objects from the webhook batch, flattened across entries/changes',
    },
    statuses: {
      type: 'json',
      description:
        'All message status objects from the webhook batch, flattened across entries/changes',
    },
    conversation: {
      type: 'json',
      description:
        'Conversation metadata from the first status update in the batch (id, expiration_timestamp, origin.type)',
    },
    pricing: {
      type: 'json',
      description:
        'Pricing metadata from the first status update in the batch (billable, pricing_model, category)',
    },
    raw: {
      type: 'json',
      description: 'Complete structured webhook payload from WhatsApp',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
