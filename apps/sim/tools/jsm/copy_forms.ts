import type { JsmCopyFormsParams, JsmCopyFormsResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmCopyFormsTool: ToolConfig<JsmCopyFormsParams, JsmCopyFormsResponse> = {
  id: 'jsm_copy_forms',
  name: 'JSM Copy Forms',
  description: 'Copy forms from one Jira issue to another',
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
    sourceIssueIdOrKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source issue ID or key to copy forms from (e.g., "SD-123")',
    },
    targetIssueIdOrKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target issue ID or key to copy forms to (e.g., "SD-456")',
    },
    formIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional JSON array of form UUIDs to copy (e.g., ["uuid1", "uuid2"]). If omitted, copies all forms.',
    },
  },
  request: {
    url: '/api/tools/jsm/forms/copy',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      sourceIssueIdOrKey: params.sourceIssueIdOrKey,
      targetIssueIdOrKey: params.targetIssueIdOrKey,
      formIds: params.formIds,
    }),
  },
  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          sourceIssueIdOrKey: '',
          targetIssueIdOrKey: '',
          copiedForms: [],
          errors: [],
        },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        sourceIssueIdOrKey: '',
        targetIssueIdOrKey: '',
        copiedForms: [],
        errors: [],
      },
      error: data.error,
    }
  },
  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    sourceIssueIdOrKey: { type: 'string', description: 'Source issue ID or key' },
    targetIssueIdOrKey: { type: 'string', description: 'Target issue ID or key' },
    copiedForms: { type: 'json', description: 'Array of successfully copied forms' },
    errors: { type: 'json', description: 'Array of errors encountered during copy' },
  },
}
