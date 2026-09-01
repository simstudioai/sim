import type { AshbyApplication } from '@/tools/ashby/types'
import {
  APPLICATION_OUTPUTS,
  ASHBY_ON_BEHALF_OF_PARAM,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  ashbyIsoDateTime,
  mapApplication,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyChangeApplicationStageParams {
  apiKey: string
  onBehalfOfUserId?: string
  applicationId: string
  interviewStageId: string
  archiveReasonId?: string
  archiveEmail?: {
    communicationTemplateId: string
    sendAt?: string | null
  } | null
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
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Archive email configuration with communicationTemplateId and optional sendAt ISO 8601 timestamp. Pass null or omit to send no archive email.',
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
      if (params.archiveEmail === null) {
        body.archiveEmail = null
      } else if (params.archiveEmail !== undefined) {
        const communicationTemplateId = params.archiveEmail.communicationTemplateId?.trim()
        if (!communicationTemplateId) {
          throw new Error(
            'Invalid archiveEmail: communicationTemplateId is required when configuring an archive email.'
          )
        }
        const archiveEmail: Record<string, unknown> = { communicationTemplateId }
        if (params.archiveEmail.sendAt === null) {
          archiveEmail.sendAt = null
        } else if (params.archiveEmail.sendAt !== undefined) {
          archiveEmail.sendAt = ashbyIsoDateTime(params.archiveEmail.sendAt, 'archiveEmail.sendAt')
        }
        body.archiveEmail = archiveEmail
      }
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
