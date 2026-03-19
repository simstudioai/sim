import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyGetJobPostingParams {
  apiKey: string
  jobPostingId: string
}

interface AshbyGetJobPostingResponse extends ToolResponse {
  output: {
    id: string
    title: string
    jobId: string | null
    locationName: string | null
    departmentName: string | null
    employmentType: string | null
    descriptionPlain: string | null
    isListed: boolean
    publishedDate: string | null
    externalLink: string | null
  }
}

export const getJobPostingTool: ToolConfig<AshbyGetJobPostingParams, AshbyGetJobPostingResponse> = {
  id: 'ashby_get_job_posting',
  name: 'Ashby Get Job Posting',
  description: 'Retrieves full details about a single job posting by its ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    jobPostingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the job posting to fetch',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/jobPosting.info',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => ({
      jobPostingId: params.jobPostingId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get job posting')
    }

    const r = data.results

    return {
      success: true,
      output: {
        id: r.id ?? null,
        title: r.jobTitle ?? r.title ?? null,
        jobId: r.jobId ?? null,
        locationName: r.locationName ?? null,
        departmentName: r.departmentName ?? null,
        employmentType: r.employmentType ?? null,
        descriptionPlain: r.descriptionPlain ?? r.description ?? null,
        isListed: r.isListed ?? false,
        publishedDate: r.publishedDate ?? null,
        externalLink: r.externalLink ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Job posting UUID' },
    title: { type: 'string', description: 'Job posting title' },
    jobId: { type: 'string', description: 'Associated job UUID', optional: true },
    locationName: { type: 'string', description: 'Location name', optional: true },
    departmentName: { type: 'string', description: 'Department name', optional: true },
    employmentType: {
      type: 'string',
      description: 'Employment type (e.g. FullTime, PartTime, Contract)',
      optional: true,
    },
    descriptionPlain: {
      type: 'string',
      description: 'Job posting description in plain text',
      optional: true,
    },
    isListed: { type: 'boolean', description: 'Whether the posting is publicly listed' },
    publishedDate: { type: 'string', description: 'ISO 8601 published date', optional: true },
    externalLink: {
      type: 'string',
      description: 'External link to the job posting',
      optional: true,
    },
  },
}
