import { GoogleFormsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

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
    // Google Forms Credentials (basic mode)
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'google-forms',
      requiredScopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/forms.responses.readonly',
      ],
      placeholder: 'Select Google account',
      mode: 'basic',
    },
    // Direct access token (advanced mode)
    {
      id: 'accessToken',
      title: 'Access Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter OAuth access token',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter the Google Form ID',
    },
    {
      id: 'responseId',
      title: 'Response ID',
      type: 'short-input',
      placeholder: 'Enter a specific response ID',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Max responses to retrieve (default 5000)',
    },
    ...getTrigger('google_forms_webhook').subBlocks,
  ],
  tools: {
    access: ['google_forms_get_responses'],
    config: {
      tool: () => 'google_forms_get_responses',
      params: (params) => {
        const { credential, accessToken, formId, responseId, pageSize, ...rest } = params

        const effectiveFormId = String(formId || '').trim()
        if (!effectiveFormId) {
          throw new Error('Form ID is required.')
        }

        return {
          ...rest,
          formId: effectiveFormId,
          responseId: responseId ? String(responseId).trim() : undefined,
          pageSize: pageSize ? Number(pageSize) : undefined,
          ...(credential ? { credential } : { accessToken }),
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
