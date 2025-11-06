import { TypeformIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const typeformWebhookTrigger: TriggerConfig = {
  id: 'typeform_webhook',
  name: 'Typeform Webhook',
  provider: 'typeform',
  description: 'Trigger workflow when a Typeform submission is received',
  version: '1.0.0',
  icon: TypeformIcon,

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
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      placeholder: 'Enter your Typeform form ID',
      description:
        'The unique identifier for your Typeform. Find it in the form URL or form settings.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'apiKey',
      title: 'Personal Access Token',
      type: 'short-input',
      placeholder: 'Enter your Typeform personal access token',
      description:
        'Required to automatically register the webhook with Typeform. Get yours at https://admin.typeform.com/account#/section/tokens',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'secret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a secret for webhook signature verification (optional)',
      description:
        'A secret string used to verify webhook authenticity. Highly recommended for security. Generate a secure random string (min 20 characters recommended).',
      password: true,
      required: false,
      mode: 'trigger',
    },
    {
      id: 'includeDefinition',
      title: 'Include Form Definition',
      type: 'switch',
      description:
        'Include the complete form structure (questions, fields, endings) in your workflow variables. Note: Typeform always sends this data, but enabling this makes it accessible in your workflow.',
      defaultValue: false,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: [
        'Get your Typeform Personal Access Token from <a href="https://admin.typeform.com/account#/section/tokens" target="_blank" rel="noopener noreferrer">https://admin.typeform.com/account#/section/tokens</a>',
        'Find your Form ID in the URL when editing your form (e.g., <code>https://admin.typeform.com/form/ABC123/create</code> → Form ID is <code>ABC123</code>)',
        'Fill in the form above with your Form ID and Personal Access Token',
        'Optionally add a Webhook Secret for enhanced security - Sim will verify all incoming webhooks match this secret',
        'Click "Save" below - Sim will automatically register the webhook with Typeform',
        '<strong>Note:</strong> Requires a Typeform PRO or PRO+ account to use webhooks',
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
      triggerId: 'typeform_webhook',
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          event_id: '01HQZYX5K2F4G8H9J0K1L2M3N4',
          event_type: 'form_response',
          form_response: {
            form_id: 'ABC123',
            token: 'def456ghi789jkl012',
            submitted_at: '2025-01-15T10:30:00Z',
            landed_at: '2025-01-15T10:28:45Z',
            calculated: {
              score: 85,
            },
            variables: [
              {
                key: 'score',
                type: 'number',
                number: 4,
              },
              {
                key: 'name',
                type: 'text',
                text: 'typeform',
              },
            ],
            hidden: {
              utm_source: 'newsletter',
              utm_campaign: 'spring_2025',
            },
            answers: [
              {
                type: 'text',
                text: 'John Doe',
                field: {
                  id: 'abc123',
                  type: 'short_text',
                  ref: 'name_field',
                },
              },
              {
                type: 'email',
                email: 'john@example.com',
                field: {
                  id: 'def456',
                  type: 'email',
                  ref: 'email_field',
                },
              },
              {
                type: 'choice',
                choice: {
                  id: 'meFVw3iGRxZB',
                  label: 'Very Satisfied',
                  ref: 'ed7f4756-c28f-4374-bb65-bfe5e3235c0c',
                },
                field: {
                  id: 'ghi789',
                  type: 'multiple_choice',
                  ref: 'satisfaction_field',
                },
              },
              {
                type: 'choices',
                choices: {
                  ids: ['eXnU3oA141Cg', 'aTZmZGYV6liX', 'bCdEfGhIjKlM'],
                  labels: ['TypeScript', 'Python', 'Go'],
                  refs: [
                    '238d1802-9921-4687-a37b-5e50f56ece8e',
                    'd867c542-1e72-4619-908f-aaae38cabb61',
                    'f123g456-h789-i012-j345-k678l901m234',
                  ],
                },
                field: {
                  id: 'jkl012',
                  type: 'multiple_choice',
                  ref: 'languages_field',
                },
              },
              {
                type: 'number',
                number: 5,
                field: {
                  id: 'mno345',
                  type: 'number',
                  ref: 'rating_field',
                },
              },
              {
                type: 'boolean',
                boolean: true,
                field: {
                  id: 'pqr678',
                  type: 'yes_no',
                  ref: 'subscribe_field',
                },
              },
              {
                type: 'date',
                date: '2025-01-20',
                field: {
                  id: 'stu901',
                  type: 'date',
                  ref: 'appointment_field',
                },
              },
            ],
            definition: {
              id: 'ABC123',
              title: 'Customer Feedback Survey',
              fields: [
                {
                  id: 'abc123',
                  title: 'What is your name?',
                  type: 'short_text',
                  ref: 'name_field',
                },
                {
                  id: 'def456',
                  title: 'What is your email?',
                  type: 'email',
                  ref: 'email_field',
                },
              ],
              endings: [
                {
                  id: 'end123',
                  title: 'Thank you!',
                  type: 'thankyou_screen',
                },
              ],
            },
            ending: {
              id: 'end123',
              ref: '01GRC8GR2017M6WW347T86VV39',
            },
          },
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
    event_id: {
      type: 'string',
      description: 'Unique identifier for this webhook event',
    },
    event_type: {
      type: 'string',
      description: 'Type of event (always "form_response" for form submissions)',
    },
    form_id: {
      type: 'string',
      description: 'Typeform form identifier',
    },
    token: {
      type: 'string',
      description: 'Unique response/submission identifier',
    },
    submitted_at: {
      type: 'string',
      description: 'ISO timestamp when the form was submitted',
    },
    landed_at: {
      type: 'string',
      description: 'ISO timestamp when the user first landed on the form',
    },
    calculated: {
      score: {
        type: 'number',
        description: 'Calculated score value',
      },
    },
    variables: {
      type: 'array',
      description: 'Array of dynamic variables with key, type, and value',
    },
    hidden: {
      type: 'json',
      description: 'Hidden fields passed to the form (e.g., UTM parameters)',
    },
    answers: {
      type: 'array',
      description:
        'Array of respondent answers (only includes answered questions). Each answer contains type, value, and field reference.',
    },
    definition: {
      id: {
        type: 'string',
        description: 'Form ID',
      },
      title: {
        type: 'string',
        description: 'Form title',
      },
      fields: {
        type: 'array',
        description: 'Array of form fields',
      },
      endings: {
        type: 'array',
        description: 'Array of form endings',
      },
    },
    ending: {
      id: {
        type: 'string',
        description: 'Ending screen ID',
      },
      ref: {
        type: 'string',
        description: 'Ending screen reference',
      },
    },
    raw: {
      type: 'json',
      description: 'Complete original webhook payload from Typeform',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Typeform-Signature': 'sha256=<signature>',
    },
  },
}
