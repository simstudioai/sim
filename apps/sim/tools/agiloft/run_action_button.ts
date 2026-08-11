import type {
  AgiloftRunActionButtonParams,
  AgiloftRunActionButtonResponse,
} from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftRunActionButtonTool: ToolConfig<
  AgiloftRunActionButtonParams,
  AgiloftRunActionButtonResponse
> = {
  id: 'agiloft_run_action_button',
  name: 'Agiloft Run Action Button',
  description:
    'Run an action button on an Agiloft record, such as an approval or send-for-signature step.',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft instance URL (e.g., https://mycompany.agiloft.com)',
    },
    knowledgeBase: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Knowledge base name',
    },
    login: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft password',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name (e.g., "contracts", "case")',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the record to run the action button on',
    },
    actionButtonField: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Logical name of the field holding the action button (e.g., "ab_field")',
    },
  },

  request: {
    url: () => '/api/tools/agiloft/run_action_button',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      recordId: params.recordId,
      actionButtonField: params.actionButtonField,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: data.success ?? true,
      output: data.output,
      ...(data.error ? { error: data.error } : {}),
    }
  },

  outputs: {
    recordId: {
      type: 'string',
      description: 'ID of the record the action button was run on',
    },
    callbackId: {
      type: 'string',
      optional: true,
      description:
        'Callback identifier for the asynchronous run, which Agiloft returns as EWCALLBACK_ID',
    },
  },
}
