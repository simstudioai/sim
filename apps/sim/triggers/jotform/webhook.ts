import { JotformIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const jotformWebhookTrigger: TriggerConfig = {
  id: 'jotform_webhook',
  name: 'Jotform Webhook',
  provider: 'jotform',
  description: 'Trigger workflow when a Jotform submission is received',
  version: '1.0.0',
  icon: JotformIcon,

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
      placeholder: 'Enter your Jotform form ID',
      description:
        'The unique identifier for your Jotform. Find it in the form URL (e.g., https://form.jotform.com/241234567890 → Form ID is 241234567890).',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Copy the Webhook URL above',
        'Go to your Jotform form settings at <a href="https://www.jotform.com/myforms/" target="_blank" rel="noopener noreferrer">https://www.jotform.com/myforms/</a>',
        'Select your form and click on "Settings"',
        'Navigate to "Integrations" and search for "Webhooks"',
        'Add a new webhook and paste the URL copied from above',
        'Click "Complete Integration" to save',
        '<strong>Note:</strong> Jotform will send a POST request to your webhook URL with form submission data',
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
      triggerId: 'jotform_webhook',
    },
  ],

  outputs: {
    'webhook.data.payload.slug': {
      type: 'string',
      description: 'Submission slug (e.g., submit/253605100868051)',
    },
    'webhook.data.payload.event_id': {
      type: 'string',
      description: 'Unique event identifier for this submission',
    },
    'webhook.data.payload.submitDate': {
      type: 'string',
      description: 'Unix timestamp when the form was submitted',
    },
    'webhook.data.payload.submitSource': {
      type: 'string',
      description: 'Source of submission (e.g., form)',
    },
    'webhook.data.payload.timeToSubmit': {
      type: 'string',
      description: 'Time taken to submit the form in seconds',
    },
    'webhook.data.payload': {
      type: 'json',
      description:
        'Complete webhook payload from Jotform. Access form fields using their IDs (e.g., webhook.data.payload.q3_q3_email1 for email, webhook.data.payload.q2_q2_fullname0.first for first name). Field IDs vary by form structure.',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  },
}
