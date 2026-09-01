import type { AshbyApplication } from '@/tools/ashby/types'
import {
  APPLICATION_OUTPUTS,
  ASHBY_ON_BEHALF_OF_PARAM,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  mapApplication,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyChangeApplicationStageParams {
  apiKey: string
  onBehalfOfUserId?: string
  applicationId: string
  interviewStageId: string
  archiveReasonId?: string
  archiveEmail?: boolean
}

interface AshbyChangeApplicationStageResponse extends ToolResponse {
  output: AshbyApplication
}

export const changeApplicationStageTool: ToolConfig<
  AshbyChangeApplicationStageParams,
  AshbyChangeApplicationStageResponse
> = {
  id: 'ashby_change_application_stage',
  name: 'Ashby Change Application Stage',
  description:
    'Moves an application to a different interview stage. Requires an archive reason when moving to an Archived stage.',
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
      description: 'The UUID of the application to update the stage of',
    },
    interviewStageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the interview stage to move the application to',
    },
    archiveReasonId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Archive reason UUID. Required when moving to an Archived stage, ignored otherwise',
    },
    archiveEmail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send Ashby archive email automation when archiving',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/application.changeStage',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey, params.onBehalfOfUserId),
    body: (params) => {
      const body: Record<string, unknown> = {
        applicationId: params.applicationId.trim(),
        interviewStageId: params.interviewStageId.trim(),
      }
      if (params.archiveReasonId) body.archiveReasonId = params.archiveReasonId.trim()
      if (params.archiveEmail !== undefined) body.archiveEmail = params.archiveEmail
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to change application stage'))
    }

    return {
      success: true,
      output: mapApplication(data.results),
    }
  },

  outputs: APPLICATION_OUTPUTS,
}
