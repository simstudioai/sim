import type { JsmDeleteFormParams, JsmDeleteFormResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmDeleteFormTool: ToolConfig<JsmDeleteFormParams, JsmDeleteFormResponse> = {
  id: 'jsm_delete_form',
  name: 'JSM Delete Form',
  description: 'Remove a form from a Jira issue or JSM request',
  version: '1.0.0',
  oauth: { required: true, provider: 'jira' },
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
    issueIdOrKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue ID or key (e.g., "SD-123")',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Form instance UUID to delete',
    },
  },
  request: {
    url: '/api/tools/jsm/forms/delete',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      formId: params.formId,
    }),
  },
  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), issueIdOrKey: '', formId: '', deleted: false },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        issueIdOrKey: '',
        formId: '',
        deleted: false,
      },
      error: data.error,
    }
  },
  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    formId: { type: 'string', description: 'Deleted form instance UUID' },
    deleted: { type: 'boolean', description: 'Whether the form was successfully deleted' },
  },
}
