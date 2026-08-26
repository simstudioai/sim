import type { AgiloftAsyncStatusParams, AgiloftAsyncStatusResponse } from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftAsyncStatusTool: ToolConfig<
  AgiloftAsyncStatusParams,
  AgiloftAsyncStatusResponse
> = {
  id: 'agiloft_async_status',
  name: 'Agiloft Async Status',
  description:
    'Check whether an asynchronous Agiloft call, such as a run action button, has completed.',
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
      description: 'Table the asynchronous call was made against',
    },
    callbackId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Callback ID returned by the asynchronous call, e.g. from Run Action Button',
    },
  },

  request: {
    internal: true,
    url: () => '/api/tools/agiloft/async_status',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      callbackId: params.callbackId,
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
    callbackId: { type: 'string', description: 'Callback ID that was checked' },
    statusCode: { type: 'number', description: 'Raw status code Agiloft returned' },
    status: {
      type: 'string',
      description: 'completed, queued, in_progress, failed, or unknown_callback',
    },
    complete: {
      type: 'boolean',
      description: 'True when the operation has finished, whether it succeeded or failed',
    },
  },
}
