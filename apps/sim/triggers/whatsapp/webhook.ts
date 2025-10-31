import { WhatsAppIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const whatsappWebhookTrigger: TriggerConfig = {
  id: 'whatsapp_webhook',
  name: 'WhatsApp Webhook',
  provider: 'whatsapp',
  description: 'Trigger workflow from WhatsApp messages and events via Business Platform webhooks',
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
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: [
        'Go to your <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline transition-colors hover:text-muted-foreground/80">Meta for Developers Apps</a> page and navigate to the "Build with us" --> "App Events" section.',
        'If you don\'t have an app:<br><ul class="mt-1 ml-5 list-disc"><li>Create an app from scratch</li><li>Give it a name and select your workspace</li></ul>',
        'Select your App, then navigate to WhatsApp > Configuration.',
        'Find the Webhooks section and click "Edit".',
        'Paste the <strong>Webhook URL</strong> above into the "Callback URL" field.',
        'Paste the <strong>Verification Token</strong> into the "Verify token" field.',
        'Click "Verify and save".',
        'Click "Manage" next to Webhook fields and subscribe to `messages`.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'whatsapp_webhook',
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          object: 'whatsapp_business_account',
          entry: [
            {
              id: '1234567890123456',
              changes: [
                {
                  value: {
                    messaging_product: 'whatsapp',
                    metadata: {
                      display_phone_number: '15551234567',
                      phone_number_id: '1234567890123456',
                    },
                    contacts: [
                      {
                        profile: {
                          name: 'John Doe',
                        },
                        wa_id: '15555551234',
                      },
                    ],
                    messages: [
                      {
                        from: '15555551234',
                        id: 'wamid.HBgNMTU1NTU1NTEyMzQVAgASGBQzQTdBNjg4QjU2NjZCMzY4ODE2AA==',
                        timestamp: '1234567890',
                        text: {
                          body: 'Hello from WhatsApp!',
                        },
                        type: 'text',
                      },
                    ],
                  },
                  field: 'messages',
                },
              ],
            },
          ],
        },
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
    },
  ],

  outputs: {
    messageId: {
      type: 'string',
      description: 'Unique message identifier',
    },
    from: {
      type: 'string',
      description: 'Phone number of the message sender',
    },
    phoneNumberId: {
      type: 'string',
      description: 'WhatsApp Business phone number ID that received the message',
    },
    text: {
      type: 'string',
      description: 'Message text content',
    },
    timestamp: {
      type: 'string',
      description: 'Message timestamp',
    },
    raw: {
      type: 'string',
      description: 'Complete raw message object from WhatsApp as JSON string',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
