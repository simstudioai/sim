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
    id: string
    status: string
    candidate: {
      id: string
      name: string
    }
    job: {
      id: string
      title: string
    }
    currentInterviewStage: {
      id: string
      title: string
      type: string
    } | null
    source: {
      id: string
      title: string
    } | null
    createdAt: string
    updatedAt: string
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
        id: r.id ?? null,
        status: r.status ?? null,
        candidate: {
          id: r.candidate?.id ?? null,
          name: r.candidate?.name ?? null,
        },
        job: {
          id: r.job?.id ?? null,
          title: r.job?.title ?? null,
        },
        currentInterviewStage: r.currentInterviewStage
          ? {
              id: r.currentInterviewStage.id ?? null,
              title: r.currentInterviewStage.title ?? null,
              type: r.currentInterviewStage.type ?? null,
            }
          : null,
        source: r.source
          ? {
              id: r.source.id ?? null,
              title: r.source.title ?? null,
            }
          : null,
        createdAt: r.createdAt ?? null,
        updatedAt: r.updatedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created application UUID' },
    status: { type: 'string', description: 'Application status (Active, Hired, Archived, Lead)' },
    candidate: {
      type: 'object',
      description: 'Associated candidate',
      properties: {
        id: { type: 'string', description: 'Candidate UUID' },
        name: { type: 'string', description: 'Candidate name' },
      },
    },
    job: {
      type: 'object',
      description: 'Associated job',
      properties: {
        id: { type: 'string', description: 'Job UUID' },
        title: { type: 'string', description: 'Job title' },
      },
    },
    currentInterviewStage: {
      type: 'object',
      description: 'Current interview stage',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Stage UUID' },
        title: { type: 'string', description: 'Stage title' },
        type: { type: 'string', description: 'Stage type' },
      },
    },
    source: {
      type: 'object',
      description: 'Application source',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Source UUID' },
        title: { type: 'string', description: 'Source title' },
      },
    },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp' },
  },
}
