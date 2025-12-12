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
      hideFromPreview: true,
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
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'typeform_webhook',
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
