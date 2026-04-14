import type { JsmGetFormAnswersParams, JsmGetFormAnswersResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetFormAnswersTool: ToolConfig<JsmGetFormAnswersParams, JsmGetFormAnswersResponse> =
  {
    id: 'jsm_get_form_answers',
    name: 'JSM Get Form Answers',
    description: 'Get simplified answers from a form attached to a Jira issue or JSM request',
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
    },

    request: {
      url: '/api/tools/jsm/forms/answers',
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
            answers: null,
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
          answers: null,
        },
        error: data.error,
      }
    },

    outputs: {
      ts: { type: 'string', description: 'Timestamp of the operation' },
      issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
      formId: { type: 'string', description: 'Form instance UUID' },
      answers: {
        type: 'json',
        description:
          'Simplified form answers as key-value pairs (question label to answer text/choices)',
        optional: true,
      },
    },
  }
