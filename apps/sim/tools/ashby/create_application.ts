import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyCreateApplicationParams {
  apiKey: string
  candidateId: string
  jobId: string
  interviewPlanId?: string
  interviewStageId?: string
  sourceId?: string
  creditedToUserId?: string
  createdAt?: string
}

interface AshbyCreateApplicationResponse extends ToolResponse {
  output: {
    applicationId: string
  }
}

export const createApplicationTool: ToolConfig<
  AshbyCreateApplicationParams,
  AshbyCreateApplicationResponse
> = {
  id: 'ashby_create_application',
  name: 'Ashby Create Application',
  description:
    'Creates a new application for a candidate on a job. Optionally specify interview plan, stage, source, and credited user.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the candidate to consider for the job',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the job to consider the candidate for',
    },
    interviewPlanId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the interview plan to use (defaults to the job default plan)',
    },
    interviewStageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'UUID of the interview stage to place the application in (defaults to first Lead stage)',
    },
    sourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the source to set on the application',
    },
    creditedToUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the user the application is credited to',
    },
    createdAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp to set as the application creation date (defaults to now)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/application.create',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        candidateId: params.candidateId,
        jobId: params.jobId,
      }
      if (params.interviewPlanId) body.interviewPlanId = params.interviewPlanId
      if (params.interviewStageId) body.interviewStageId = params.interviewStageId
      if (params.sourceId) body.sourceId = params.sourceId
      if (params.creditedToUserId) body.creditedToUserId = params.creditedToUserId
      if (params.createdAt) body.createdAt = params.createdAt
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to create application')
    }

    const r = data.results

    return {
      success: true,
      output: {
        applicationId: r.applicationId ?? null,
      },
    }
  },

  outputs: {
    applicationId: { type: 'string', description: 'Created application UUID' },
  },
}
