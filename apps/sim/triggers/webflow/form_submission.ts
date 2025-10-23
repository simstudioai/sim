import { WebflowIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const webflowFormSubmissionTrigger: TriggerConfig = {
  id: 'webflow_form_submission',
  name: 'Form Submission',
  provider: 'webflow',
  description:
    'Trigger workflow when a form is submitted on a Webflow site (requires Webflow credentials)',
  version: '1.0.0',
  icon: WebflowIcon,

  // Webflow requires OAuth credentials to create webhooks
  requiresCredentials: true,
  credentialProvider: 'webflow',

  configFields: {
    siteId: {
      type: 'select',
      label: 'Site',
      placeholder: 'Select a site',
      description: 'The Webflow site to monitor',
      required: true,
      options: [], // Will be populated dynamically from API
    },
    formId: {
      type: 'string',
      label: 'Form ID',
      placeholder: 'form-123abc (optional)',
      description: 'The ID of the specific form to monitor (optional - leave empty for all forms)',
      required: false,
    },
  },

  outputs: {
    siteId: {
      type: 'string',
      description: 'The site ID where the form was submitted',
    },
    workspaceId: {
      type: 'string',
      description: 'The workspace ID where the event occurred',
    },
    name: {
      type: 'string',
      description: 'The name of the form',
    },
    id: {
      type: 'string',
      description: 'The unique ID of the form submission',
    },
    submittedAt: {
      type: 'string',
      description: 'Timestamp when the form was submitted',
    },
    data: {
      type: 'object',
      description: 'The form submission field data (keys are field names)',
    },
    schema: {
      type: 'object',
      description: 'Form schema information',
    },
    formElementId: {
      type: 'string',
      description: 'The form element ID',
    },
  },

  instructions: [
    'Connect your Webflow account using the "Select Webflow credential" button above.',
    'Enter your Webflow Site ID (found in the site URL or site settings).',
    'Optionally enter a Form ID to monitor only a specific form.',
    'If no Form ID is provided, the trigger will fire for any form submission on the site.',
    'The webhook will trigger whenever a form is submitted on the specified site.',
    'Form data will be included in the payload with all submitted field values.',
    'Make sure your Webflow account has appropriate permissions for the specified site.',
  ],

  samplePayload: {
    siteId: '6c3592',
    workspaceId: 'abc123def456',
    name: 'Contact Form',
    id: 'sub-abc123xyz',
    submittedAt: '2024-01-15T12:00:00.000Z',
    data: {
      name: 'John Doe',
      email: 'john@example.com',
      message: 'I would like more information about your services.',
      'consent-checkbox': 'true',
    },
    schema: {
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'message', type: 'textarea' },
      ],
    },
    formElementId: 'form-contact-123',
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
