import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyChangeApplicationStageParams {
  apiKey: string
  applicationId: string
  interviewStageId: string
  archiveReasonId?: string
}

interface AshbyChangeApplicationStageResponse extends ToolResponse {
  output: {
    applicationId: string
    stageId: string | null
  }
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
  },

  request: {
    url: 'https://api.ashbyhq.com/application.changeStage',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        applicationId: params.applicationId,
        interviewStageId: params.interviewStageId,
      }
      if (params.archiveReasonId) body.archiveReasonId = params.archiveReasonId
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to change application stage')
    }

    const r = data.results

    return {
      success: true,
      output: {
        applicationId: r.id ?? null,
        stageId: r.currentInterviewStage?.id ?? null,
      },
    }
  },

  outputs: {
    applicationId: { type: 'string', description: 'Application UUID' },
    stageId: { type: 'string', description: 'New interview stage UUID' },
  },
}
