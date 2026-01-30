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
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'typeform_webhook',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Get your Typeform Personal Access Token from <a href="https://admin.typeform.com/account#/section/tokens" target="_blank" rel="noopener noreferrer">https://admin.typeform.com/account#/section/tokens</a>',
        'Find your Form ID in the URL when editing your form (e.g., <code>https://admin.typeform.com/form/ABC123/create</code> → Form ID is <code>ABC123</code>)',
        'Fill in the form above with your Form ID and Personal Access Token',
        'Optionally add a Webhook Secret for enhanced security - Sim will verify all incoming webhooks match this secret',
        'Sim will automatically register the webhook with Typeform when you deploy the workflow',
        '<strong>Note:</strong> Requires a Typeform PRO or PRO+ account to use webhooks',
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
      type: 'object',
      description: 'Calculated values from the form',
      properties: {
        score: {
          type: 'number',
          description: 'Calculated score value',
        },
      },
    },
    variables: {
      type: 'array',
      description: 'Array of dynamic variables',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable key' },
          number: { type: 'number', description: 'Numeric value (if type is number)' },
          text: { type: 'string', description: 'Text value (if type is text)' },
        },
      },
    },
    hidden: {
      type: 'object',
      description: 'Hidden fields passed to the form (e.g., UTM parameters)',
    },
    answers: {
      type: 'array',
      description: 'Array of respondent answers (only includes answered questions)',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text answer value' },
          email: { type: 'string', description: 'Email answer value' },
          number: { type: 'number', description: 'Number answer value' },
          boolean: { type: 'boolean', description: 'Boolean answer value' },
          date: { type: 'string', description: 'Date answer value (ISO format)' },
          url: { type: 'string', description: 'URL answer value' },
          file_url: { type: 'string', description: 'File URL answer value' },
          choice: {
            type: 'object',
            description: 'Single choice answer',
            properties: {
              id: { type: 'string', description: 'Choice ID' },
              ref: { type: 'string', description: 'Choice reference' },
              label: { type: 'string', description: 'Choice label' },
            },
          },
          choices: {
            type: 'object',
            description: 'Multiple choices answer',
            properties: {
              ids: { type: 'array', description: 'Array of choice IDs' },
              refs: { type: 'array', description: 'Array of choice refs' },
              labels: { type: 'array', description: 'Array of choice labels' },
            },
          },
          field: {
            type: 'object',
            description: 'Field reference',
            properties: {
              id: { type: 'string', description: 'Field ID' },
              ref: { type: 'string', description: 'Field reference' },
            },
          },
        },
      },
    },
    definition: {
      type: 'object',
      description: 'Form definition (only included when "Include Form Definition" is enabled)',
      properties: {
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
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Field ID' },
              ref: { type: 'string', description: 'Field reference' },
              title: { type: 'string', description: 'Field title' },
            },
          },
        },
        endings: {
          type: 'array',
          description: 'Array of form endings',
        },
      },
    },
    ending: {
      type: 'object',
      description: 'Ending screen information',
      properties: {
        id: {
          type: 'string',
          description: 'Ending screen ID',
        },
        ref: {
          type: 'string',
          description: 'Ending screen reference',
        },
      },
    },
    raw: {
      type: 'object',
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
