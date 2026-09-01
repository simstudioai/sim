import type { AshbyApplication } from '@/tools/ashby/types'
import {
  APPLICATION_OUTPUTS,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  mapApplication,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyGetApplicationParams {
  apiKey: string
  applicationId?: string
  submittedFormInstanceId?: string
  expand?: string[]
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
      required: false,
      visibility: 'user-or-llm',
      description: 'The UUID of the application to fetch',
    },
    submittedFormInstanceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Submitted application-form instance UUID to use instead of applicationId',
    },
    expand: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ashby-supported application expansions to include',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/application.info',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const applicationId = params.applicationId?.trim()
      const submittedFormInstanceId = params.submittedFormInstanceId?.trim()
      if (!applicationId && !submittedFormInstanceId)
        throw new Error('Provide applicationId or submittedFormInstanceId.')
      return {
        ...(applicationId ? { applicationId } : {}),
        ...(submittedFormInstanceId ? { submittedFormInstanceId } : {}),
        ...(Array.isArray(params.expand) && params.expand.length > 0
          ? { expand: params.expand }
          : {}),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to get application'))
    }

    return {
      success: true,
      output: mapApplication(data.results),
    }
  },

  outputs: APPLICATION_OUTPUTS,
}
