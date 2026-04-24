import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListJobPostingsParams {
  apiKey: string
}

interface AshbyJobPostingSummary {
  id: string
  title: string
  jobId: string | null
  departmentName: string | null
  teamName: string | null
  locationName: string | null
  locationIds: {
    primaryLocationId: string | null
    secondaryLocationIds: string[]
  } | null
  workplaceType: string | null
  employmentType: string | null
  isListed: boolean
  publishedDate: string | null
  applicationDeadline: string | null
  externalLink: string | null
  applyLink: string | null
  compensationTierSummary: string | null
  shouldDisplayCompensationOnJobBoard: boolean
  updatedAt: string | null
}

interface AshbyListJobPostingsResponse extends ToolResponse {
  output: {
    jobPostings: AshbyJobPostingSummary[]
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
        jobPostings: (data.results ?? []).map(
          (
            jp: Record<string, unknown> & {
              locationIds?: { primaryLocationId?: string; secondaryLocationIds?: string[] }
            }
          ) => ({
            id: (jp.id as string) ?? '',
            title: (jp.title as string) ?? '',
            jobId: (jp.jobId as string) ?? null,
            departmentName: (jp.departmentName as string) ?? null,
            teamName: (jp.teamName as string) ?? null,
            locationName: (jp.locationName as string) ?? null,
            locationIds: jp.locationIds
              ? {
                  primaryLocationId: jp.locationIds.primaryLocationId ?? null,
                  secondaryLocationIds: Array.isArray(jp.locationIds.secondaryLocationIds)
                    ? jp.locationIds.secondaryLocationIds
                    : [],
                }
              : null,
            workplaceType: (jp.workplaceType as string) ?? null,
            employmentType: (jp.employmentType as string) ?? null,
            isListed: (jp.isListed as boolean) ?? false,
            publishedDate: (jp.publishedDate as string) ?? null,
            applicationDeadline: (jp.applicationDeadline as string) ?? null,
            externalLink: (jp.externalLink as string) ?? null,
            applyLink: (jp.applyLink as string) ?? null,
            compensationTierSummary: (jp.compensationTierSummary as string) ?? null,
            shouldDisplayCompensationOnJobBoard:
              (jp.shouldDisplayCompensationOnJobBoard as boolean) ?? false,
            updatedAt: (jp.updatedAt as string) ?? null,
          })
        ),
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
          departmentName: { type: 'string', description: 'Department name', optional: true },
          teamName: { type: 'string', description: 'Team name', optional: true },
          locationName: {
            type: 'string',
            description: 'Primary location display name',
            optional: true,
          },
          locationIds: {
            type: 'object',
            description: 'Primary and secondary location UUIDs',
            optional: true,
            properties: {
              primaryLocationId: {
                type: 'string',
                description: 'Primary location UUID',
                optional: true,
              },
              secondaryLocationIds: {
                type: 'array',
                description: 'Secondary location UUIDs',
                items: { type: 'string', description: 'Location UUID' },
              },
            },
          },
          workplaceType: {
            type: 'string',
            description: 'Workplace type (OnSite, Remote, Hybrid)',
            optional: true,
          },
          employmentType: {
            type: 'string',
            description: 'Employment type (FullTime, PartTime, Intern, Contract, Temporary)',
            optional: true,
          },
          isListed: { type: 'boolean', description: 'Whether the posting is publicly listed' },
          publishedDate: {
            type: 'string',
            description: 'ISO 8601 published date',
            optional: true,
          },
          applicationDeadline: {
            type: 'string',
            description: 'ISO 8601 application deadline',
            optional: true,
          },
          externalLink: {
            type: 'string',
            description: 'External link to the job posting',
            optional: true,
          },
          applyLink: {
            type: 'string',
            description: 'Direct apply link for the job posting',
            optional: true,
          },
          compensationTierSummary: {
            type: 'string',
            description: 'Compensation tier summary for job boards',
            optional: true,
          },
          shouldDisplayCompensationOnJobBoard: {
            type: 'boolean',
            description: 'Whether compensation is shown on the job board',
          },
          updatedAt: {
            type: 'string',
            description: 'ISO 8601 last update timestamp',
            optional: true,
          },
        },
      },
    },
  },
}
