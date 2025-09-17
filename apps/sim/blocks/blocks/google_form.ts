import { GoogleFormsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const GoogleFormsBlock: BlockConfig = {
  type: 'google_forms',
  name: 'Google Forms',
  description: 'Read responses from a Google Form',
  longDescription:
    'Integrate Google Forms into your workflow. Provide a Form ID to list responses, or specify a Response ID to fetch a single response. Requires OAuth.',
  docsLink: 'https://docs.sim.ai/tools/google_forms',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleFormsIcon,
  subBlocks: [
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
      provider: 'google-forms',
      serviceId: 'google-forms',
      requiredScopes: [],
      placeholder: 'Select Google account',
    },
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the Google Form ID',
      dependsOn: ['credential'],
    },
    {
      id: 'responseId',
      title: 'Response ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter a specific response ID',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Max responses to retrieve (default 5000)',
    },
    // Trigger configuration (shown when block is in trigger mode)
    {
      id: 'triggerConfig',
      title: 'Trigger Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'google_forms',
      availableTriggers: ['google_forms_webhook'],
    },
  ],
  tools: {
    access: ['google_forms_get_responses'],
    config: {
      tool: () => 'google_forms_get_responses',
      params: (params) => {
        const { credential, formId, responseId, pageSize, ...rest } = params

        const effectiveFormId = String(formId || '').trim()
        if (!effectiveFormId) {
          throw new Error('Form ID is required.')
        }

        return {
          ...rest,
          formId: effectiveFormId,
          responseId: responseId ? String(responseId).trim() : undefined,
          pageSize: pageSize ? Number(pageSize) : undefined,
          credential,
        }
      },
    },
  },
  inputs: {
    credential: { type: 'string', description: 'Google OAuth credential' },
    formId: { type: 'string', description: 'Google Form ID' },
    responseId: { type: 'string', description: 'Specific response ID' },
    pageSize: { type: 'string', description: 'Max responses to retrieve (default 5000)' },
  },
  outputs: {
    data: { type: 'json', description: 'Response or list of responses' },
  },
  triggers: {
    enabled: true,
    available: ['google_forms_webhook'],
  },
}
