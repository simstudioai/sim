import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListJobPostingsParams {
  apiKey: string
}

interface AshbyListJobPostingsResponse extends ToolResponse {
  output: {
    jobPostings: Array<{
      id: string
      title: string
      jobId: string | null
      locationName: string | null
      departmentName: string | null
      employmentType: string | null
      isListed: boolean
      publishedDate: string | null
    }>
  }
}

export const listJobPostingsTool: ToolConfig<
  AshbyListJobPostingsParams,
  AshbyListJobPostingsResponse
> = {
  id: 'ashby_list_job_postings',
  name: 'Ashby List Job Postings',
  description: 'Lists all job postings in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/jobPosting.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list job postings')
    }

    return {
      success: true,
      output: {
        jobPostings: (data.results ?? []).map((jp: Record<string, unknown>) => ({
          id: jp.id ?? null,
          title: (jp.jobTitle as string) ?? (jp.title as string) ?? null,
          jobId: jp.jobId ?? null,
          locationName: jp.locationName ?? null,
          departmentName: jp.departmentName ?? null,
          employmentType: jp.employmentType ?? null,
          isListed: jp.isListed ?? false,
          publishedDate: jp.publishedDate ?? null,
        })),
      },
    }
  },

  outputs: {
    jobPostings: {
      type: 'array',
      description: 'List of job postings',
      items: {
        type: 'object',
        properties: {
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
          isListed: { type: 'boolean', description: 'Whether the posting is publicly listed' },
          publishedDate: { type: 'string', description: 'ISO 8601 published date', optional: true },
        },
      },
    },
  },
}
