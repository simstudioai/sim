import { GoogleFormsIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const googleFormsWebhookTrigger: TriggerConfig = {
  id: 'google_forms_webhook',
  name: 'Google Forms Webhook',
  provider: 'google_forms',
  description: 'Trigger workflow from Google Form submissions (via Apps Script forwarder)',
  version: '1.0.0',
  icon: GoogleFormsIcon,

  configFields: {
    token: {
      type: 'string',
      label: 'Shared Secret',
      placeholder: 'Enter a secret used by your Apps Script forwarder',
      description:
        'We validate requests using this secret. Send it as Authorization: Bearer <token> or a custom header.',
      required: true,
      isSecret: true,
    },
    secretHeaderName: {
      type: 'string',
      label: 'Custom Secret Header (optional)',
      placeholder: 'X-GForms-Secret',
      description:
        'If set, the webhook will validate this header equals your Shared Secret instead of Authorization.',
      required: false,
    },
    formId: {
      type: 'string',
      label: 'Form ID (optional)',
      placeholder: '1FAIpQLSd... (Google Form ID)',
      description:
        'Optional, for clarity and matching in workflows. Not required for webhook to work.',
    },
    includeRawPayload: {
      type: 'boolean',
      label: 'Include Raw Payload',
      description: 'Include the original payload from Apps Script in the workflow input.',
      defaultValue: true,
    },
  },

  outputs: {
    // Expose flattened fields at the root; nested google_forms exists at runtime for back-compat
    responseId: { type: 'string', description: 'Unique response identifier (if available)' },
    createTime: { type: 'string', description: 'Response creation timestamp' },
    lastSubmittedTime: { type: 'string', description: 'Last submitted timestamp' },
    formId: { type: 'string', description: 'Google Form ID' },
    answers: { type: 'object', description: 'Normalized map of question -> answer' },
    raw: { type: 'object', description: 'Original payload (when enabled)' },
  },

  instructions: [
    'Open your Google Form → More (⋮) → Script editor.',
    'Paste the Apps Script snippet from below into <code>Code.gs</code> → Save.',
    'Triggers (clock icon) → Add Trigger → Function: <code>onFormSubmit</code> → Event source: <code>From form</code> → Event type: <code>On form submit</code> → Save.',
    'Authorize when prompted. Submit a test response and verify the run in Sim → Logs.',
  ],

  samplePayload: {
    provider: 'google_forms',
    formId: '1FAIpQLSdEXAMPLE',
    responseId: 'R_12345',
    createTime: '2025-01-01T12:00:00.000Z',
    lastSubmittedTime: '2025-01-01T12:00:00.000Z',
    answers: {
      'What is your name?': 'Ada Lovelace',
      Languages: ['TypeScript', 'Python'],
      'Subscribed?': true,
    },
    raw: { any: 'original payload from Apps Script if included' },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
