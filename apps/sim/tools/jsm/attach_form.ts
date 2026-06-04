import type { JsmAttachFormParams, JsmAttachFormResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmAttachFormTool: ToolConfig<JsmAttachFormParams, JsmAttachFormResponse> = {
  id: 'jsm_attach_form',
  name: 'JSM Attach Form',
  description: 'Attach a form template to an existing Jira issue or JSM request',
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
    issueIdOrKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue ID or key to attach the form to (e.g., "SD-123")',
    },
    formTemplateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Form template UUID (from Get Form Templates)',
    },
  },

  request: {
    url: '/api/tools/jsm/forms/attach',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      formTemplateId: params.formTemplateId,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: '',
          id: '',
          name: '',
          updated: null,
          submitted: false,
          lock: false,
          internal: null,
          formTemplateId: null,
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
        issueIdOrKey: '',
        id: '',
        name: '',
        updated: null,
        submitted: false,
        lock: false,
        internal: null,
        formTemplateId: null,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    id: { type: 'string', description: 'Attached form instance ID (UUID)' },
    name: { type: 'string', description: 'Form name' },
    updated: { type: 'string', description: 'Last updated timestamp', optional: true },
    submitted: { type: 'boolean', description: 'Whether the form has been submitted' },
    lock: { type: 'boolean', description: 'Whether the form is locked' },
    internal: { type: 'boolean', description: 'Whether the form is internal only', optional: true },
    formTemplateId: {
      type: 'string',
      description: 'Form template ID',
      optional: true,
    },
  },
}
