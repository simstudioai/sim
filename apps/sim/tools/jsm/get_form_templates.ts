import type { JsmGetFormTemplatesParams, JsmGetFormTemplatesResponse } from '@/tools/jsm/types'
import { FORM_TEMPLATE_PROPERTIES } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetFormTemplatesTool: ToolConfig<
  JsmGetFormTemplatesParams,
  JsmGetFormTemplatesResponse
> = {
  id: 'jsm_get_form_templates',
  name: 'JSM Get Form Templates',
  description:
    'List forms (ProForma/JSM Forms) in a Jira project to discover form IDs for request types',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira Service Management',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Jira Cloud ID for the instance',
    },
    projectIdOrKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira project ID or key (e.g., "10001" or "SD")',
    },
  },

  request: {
    url: '/api/tools/jsm/forms/templates',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      projectIdOrKey: params.projectIdOrKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          projectIdOrKey: '',
          templates: [],
          total: 0,
        },
        error: 'Empty response from API',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        projectIdOrKey: '',
        templates: [],
        total: 0,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    projectIdOrKey: { type: 'string', description: 'Project ID or key' },
    templates: {
      type: 'array',
      description: 'List of forms in the project',
      items: {
        type: 'object',
        properties: FORM_TEMPLATE_PROPERTIES,
      },
    },
    total: { type: 'number', description: 'Total number of forms' },
  },
}
