import type { JsmSaveFormAnswersParams, JsmSaveFormAnswersResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmSaveFormAnswersTool: ToolConfig<
  JsmSaveFormAnswersParams,
  JsmSaveFormAnswersResponse
> = {
  id: 'jsm_save_form_answers',
  name: 'JSM Save Form Answers',
  description: 'Save answers to a form attached to a Jira issue or JSM request',
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
      description: 'Issue ID or key (e.g., "SD-123")',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Form instance UUID (from Attach Form or Get Issue Forms)',
    },
    answers: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Form answers using numeric question IDs as keys (e.g., {"1": {"text": "Title"}, "4": {"choices": ["5"]}})',
    },
  },

  request: {
    url: '/api/tools/jsm/forms/save',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      issueIdOrKey: params.issueIdOrKey,
      formId: params.formId,
      answers: params.answers,
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
          formId: '',
          state: null,
          updated: null,
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
        formId: '',
        state: null,
        updated: null,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    formId: { type: 'string', description: 'Form instance UUID' },
    state: {
      type: 'json',
      description: 'Form state with status (open, submitted, locked)',
      optional: true,
    },
    updated: { type: 'string', description: 'Last updated timestamp', optional: true },
  },
}
