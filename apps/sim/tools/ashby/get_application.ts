import type { AshbyApplication } from '@/tools/ashby/types'
import { APPLICATION_OUTPUTS, mapApplication } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyGetApplicationParams {
  apiKey: string
  applicationId: string
}

interface AshbyGetApplicationResponse extends ToolResponse {
  output: AshbyApplication
}

export const getApplicationTool: ToolConfig<
  AshbyGetApplicationParams,
  AshbyGetApplicationResponse
> = {
  id: 'ashby_get_application',
  name: 'Ashby Get Application',
  description: 'Retrieves full details about a single application by its ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the application to fetch',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/application.info',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => ({
      applicationId: params.applicationId.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get application')
    }

    return {
      success: true,
      output: mapApplication(data.results),
    }
  },

  outputs: APPLICATION_OUTPUTS,
}
