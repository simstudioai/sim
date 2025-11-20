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

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'This trigger requires webflow credentials to access your account.',
      provider: 'webflow',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
    },
    {
      id: 'siteId',
      title: 'Site',
      type: 'dropdown',
      placeholder: 'Select a site',
      description: 'The Webflow site to monitor',
      required: true,
      options: [],
      mode: 'trigger',
    },
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      placeholder: 'form-123abc (optional)',
      description: 'The ID of the specific form to monitor (optional - leave empty for all forms)',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your Webflow account using the "Select Webflow credential" button above.',
        'Enter your Webflow Site ID (found in the site URL or site settings).',
        'Optionally enter a Form ID to monitor only a specific form.',
        'If no Form ID is provided, the trigger will fire for any form submission on the site.',
        'The webhook will trigger whenever a form is submitted on the specified site.',
        'Form data will be included in the payload with all submitted field values.',
        'Make sure your Webflow account has appropriate permissions for the specified site.',
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
      triggerId: 'webflow_form_submission',
    },
  ],

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

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
