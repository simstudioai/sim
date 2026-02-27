import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyGetApplicationParams {
  apiKey: string
  applicationId: string
}

interface AshbyGetApplicationResponse extends ToolResponse {
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
    archiveReason: {
      id: string
      text: string
      reasonType: string
    } | null
    archivedAt: string | null
    createdAt: string
    updatedAt: string
  }
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
      applicationId: params.applicationId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get application')
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
        archiveReason: r.archiveReason
          ? {
              id: r.archiveReason.id ?? null,
              text: r.archiveReason.text ?? null,
              reasonType: r.archiveReason.reasonType ?? null,
            }
          : null,
        archivedAt: r.archivedAt ?? null,
        createdAt: r.createdAt ?? null,
        updatedAt: r.updatedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Application UUID' },
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
    archiveReason: {
      type: 'object',
      description: 'Reason for archival',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Reason UUID' },
        text: { type: 'string', description: 'Reason text' },
        reasonType: { type: 'string', description: 'Reason type' },
      },
    },
    archivedAt: { type: 'string', description: 'ISO 8601 archive timestamp', optional: true },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp' },
  },
}
