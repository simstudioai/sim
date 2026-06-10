import type { EnrichSearchJobsParams, EnrichSearchJobsResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchJobsTool: ToolConfig<EnrichSearchJobsParams, EnrichSearchJobsResponse> = {
  id: 'enrich_search_jobs',
  name: 'Enrich Search Jobs',
  description:
    'Search LinkedIn job postings by keywords with filters for location, job type, workplace type, experience level, and company.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    keywords: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search keywords (e.g., "software engineer")',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location filter (e.g., London)',
    },
    jobTypes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated job types (e.g., "full time, part time")',
    },
    workplaceTypes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated workplace types (e.g., "on site, remote")',
    },
    experienceLevels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated experience levels (e.g., "internship, associate")',
    },
    companyIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated LinkedIn company IDs to filter by (e.g., "2048, 3050")',
    },
    timePosted: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time filter (e.g., past_24hrs, past_week, past_month)',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records to skip for pagination (default: 0)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/search-jobs')
      url.searchParams.append('keywords', params.keywords.trim())
      if (params.location) url.searchParams.append('location', params.location.trim())
      if (params.jobTypes) url.searchParams.append('jobTypes', params.jobTypes)
      if (params.workplaceTypes) url.searchParams.append('workplaceTypes', params.workplaceTypes)
      if (params.experienceLevels) {
        url.searchParams.append('experienceLevels', params.experienceLevels)
      }
      if (params.companyIds) url.searchParams.append('companyIds', params.companyIds)
      if (params.timePosted) url.searchParams.append('timePosted', params.timePosted)
      if (params.start !== undefined) url.searchParams.append('start', String(params.start))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const rawJobs = data.data ?? data.jobs ?? (Array.isArray(data) ? data : [])

    const jobs = rawJobs.map((job: any) => ({
      title: job.title ?? null,
      companyName: job.company_name ?? job.companyName ?? null,
      companyLink: job.company_link ?? job.companyLink ?? null,
      companyLogo: job.company_logo_url ?? job.company_logo ?? job.companyLogo ?? null,
      location: job.location ?? null,
      url: job.url ?? job.job_url ?? job.jobUrl ?? null,
      postedDate: job.posted_date ?? job.posting_date ?? job.postedDate ?? null,
      postedTimestamp:
        job.posted_timestamp ??
        job.posting_timestamp ??
        job.timestamp ??
        job.postedTimestamp ??
        null,
      hiringStatus: job.hiring_status ?? job.hiringStatus ?? null,
      criteria: job.criteria ?? job.employment_criteria ?? job.employmentCriteria ?? null,
    }))

    return {
      success: true,
      output: {
        count: data.count ?? jobs.length,
        jobs,
      },
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Number of job postings returned',
    },
    jobs: {
      type: 'array',
      description: 'Job postings',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Job title' },
          companyName: { type: 'string', description: 'Hiring company name' },
          companyLink: { type: 'string', description: 'Company LinkedIn URL' },
          companyLogo: { type: 'string', description: 'Company logo URL' },
          location: { type: 'string', description: 'Job location' },
          url: { type: 'string', description: 'Job posting URL' },
          postedDate: { type: 'string', description: 'Date the job was posted' },
          postedTimestamp: { type: 'string', description: 'Timestamp the job was posted' },
          hiringStatus: { type: 'string', description: 'Hiring status' },
          criteria: {
            type: 'object',
            description: 'Employment criteria (seniority, type, function)',
          },
        },
      },
    },
  },
}
