import type { JsmGetFormStructureParams, JsmGetFormStructureResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetFormStructureTool: ToolConfig<
  JsmGetFormStructureParams,
  JsmGetFormStructureResponse
> = {
  id: 'jsm_get_form_structure',
  name: 'JSM Get Form Structure',
  description:
    'Get the full structure of a ProForma/JSM form including all questions, field types, choices, layout, and conditions',
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
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Form ID (UUID from Get Form Templates)',
    },
  },

  request: {
    url: '/api/tools/jsm/forms/structure',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      projectIdOrKey: params.projectIdOrKey,
      formId: params.formId,
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
          formId: '',
          design: null,
          updated: null,
          publish: null,
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
        formId: '',
        design: null,
        updated: null,
        publish: null,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    projectIdOrKey: { type: 'string', description: 'Project ID or key' },
    formId: { type: 'string', description: 'Form ID' },
    design: {
      type: 'json',
      description:
        'Full form design with questions (field types, labels, choices, validation), layout (field ordering), and conditions',
    },
    updated: { type: 'string', description: 'Last updated timestamp', optional: true },
    publish: {
      type: 'json',
      description: 'Publishing and request type configuration',
      optional: true,
    },
  },
}
