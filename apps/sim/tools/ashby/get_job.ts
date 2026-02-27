import type { ToolConfig } from '@/tools/types'
import type { AshbyGetJobParams, AshbyGetJobResponse } from './types'

export const getJobTool: ToolConfig<AshbyGetJobParams, AshbyGetJobResponse> = {
  id: 'ashby_get_job',
  name: 'Ashby Get Job',
  description: 'Retrieves full details about a single job by its ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the job to fetch',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/job.info',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => ({
      jobId: params.jobId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get job')
    }

    const r = data.results

    return {
      success: true,
      output: {
        id: r.id ?? null,
        title: r.title ?? null,
        status: r.status ?? null,
        employmentType: r.employmentType ?? null,
        departmentId: r.departmentId ?? null,
        locationId: r.locationId ?? null,
        descriptionPlain: r.descriptionPlain ?? null,
        isArchived: r.isArchived ?? false,
        createdAt: r.createdAt ?? null,
        updatedAt: r.updatedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Job UUID' },
    title: { type: 'string', description: 'Job title' },
    status: { type: 'string', description: 'Job status (Open, Closed, Draft, Archived, On Hold)' },
    employmentType: {
      type: 'string',
      description: 'Employment type (FullTime, PartTime, Intern, Contract, Temporary)',
      optional: true,
    },
    departmentId: { type: 'string', description: 'Department UUID', optional: true },
    locationId: { type: 'string', description: 'Location UUID', optional: true },
    descriptionPlain: {
      type: 'string',
      description: 'Job description in plain text',
      optional: true,
    },
    isArchived: { type: 'boolean', description: 'Whether the job is archived' },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp' },
  },
}
