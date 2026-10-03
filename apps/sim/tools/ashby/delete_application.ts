import { ASHBY_ON_BEHALF_OF_PARAM, ashbyAuthHeaders, ashbyErrorMessage } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyDeleteApplicationParams {
  apiKey: string
  onBehalfOfUserId?: string
  applicationId: string
}

interface AshbyDeleteApplicationResponse extends ToolResponse {
  output: {
    applicationId: string
  }
}

export const deleteApplicationTool: ToolConfig<
  AshbyDeleteApplicationParams,
  AshbyDeleteApplicationResponse
> = {
  id: 'ashby_delete_application',
  name: 'Ashby Delete Application',
  description:
    'Permanently deletes an application in Ashby. Requires the candidatesDelete permission, which is a separate module permission from candidatesWrite - a read and write key returns 403 here. There is no equivalent endpoint for deleting a candidate; candidate deletion is UI-only.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    ...ASHBY_ON_BEHALF_OF_PARAM,
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'UUID of the application to delete',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/application.delete',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey, params.onBehalfOfUserId),
    body: (params) => ({ applicationId: params.applicationId.trim() }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to delete application'))
    }

    const result = (data.results ?? {}) as Record<string, unknown>

    return {
      success: true,
      output: {
        applicationId: (result.applicationId as string) ?? '',
      },
    }
  },

  outputs: {
    applicationId: {
      type: 'string',
      description: 'UUID of the deleted application',
    },
  },
}
