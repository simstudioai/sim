import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyGetJobPostingParams {
  apiKey: string
  jobPostingId: string
  expandApplicationFormDefinition?: boolean
  expandSurveyFormDefinitions?: boolean
}

interface AshbyDescriptionPart {
  html: string | null
  plain: string | null
}

interface AshbyJobPosting {
  id: string
  title: string
  descriptionPlain: string | null
  descriptionHtml: string | null
  descriptionSocial: string | null
  descriptionParts: {
    descriptionOpening: AshbyDescriptionPart | null
    descriptionBody: AshbyDescriptionPart | null
    descriptionClosing: AshbyDescriptionPart | null
  } | null
  departmentName: string | null
  teamName: string | null
  teamNameHierarchy: string[]
  jobId: string | null
  locationName: string | null
  locationIds: {
    primaryLocationId: string | null
    secondaryLocationIds: string[]
  } | null
  address: {
    postalAddress: {
      addressCountry: string | null
      addressRegion: string | null
      addressLocality: string | null
      postalCode: string | null
      streetAddress: string | null
    } | null
  } | null
  isRemote: boolean
  workplaceType: string | null
  employmentType: string | null
  isListed: boolean
  suppressDescriptionOpening: boolean
  suppressDescriptionClosing: boolean
  publishedDate: string | null
  applicationDeadline: string | null
  externalLink: string | null
  applyLink: string | null
  compensation: {
    compensationTierSummary: string | null
    summaryComponents: Array<{
      summary: string | null
      compensationTypeLabel: string | null
      interval: string | null
      currencyCode: string | null
      minValue: number | null
      maxValue: number | null
    }>
    shouldDisplayCompensationOnJobBoard: boolean
  } | null
  applicationLimitCalloutHtml: string | null
  updatedAt: string | null
}

interface AshbyGetJobPostingResponse extends ToolResponse {
  output: AshbyJobPosting
}

function mapDescriptionPart(raw: unknown): AshbyDescriptionPart | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  return {
    html: (p.html as string) ?? null,
    plain: (p.plain as string) ?? null,
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
    expandApplicationFormDefinition: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include application form definition in the response',
    },
    expandSurveyFormDefinitions: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include survey form definitions in the response',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/jobPosting.info',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        jobPostingId: params.jobPostingId.trim(),
      }
      if (params.expandApplicationFormDefinition !== undefined) {
        body.expandApplicationFormDefinition = params.expandApplicationFormDefinition
      }
      if (params.expandSurveyFormDefinitions !== undefined) {
        body.expandSurveyFormDefinitions = params.expandSurveyFormDefinitions
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get job posting')
    }

    const r = (data.results ?? {}) as Record<string, unknown> & {
      descriptionParts?: Record<string, unknown>
      locationIds?: { primaryLocationId?: string; secondaryLocationIds?: string[] }
      address?: { postalAddress?: Record<string, unknown> }
      compensation?: Record<string, unknown> & {
        summaryComponents?: Array<Record<string, unknown>>
      }
    }

    const pa = r.address?.postalAddress
    const comp = r.compensation
    const summaryComponents = Array.isArray(comp?.summaryComponents) ? comp.summaryComponents : []
    const descParts = r.descriptionParts

    return {
      success: true,
      output: {
        id: (r.id as string) ?? '',
        title: (r.title as string) ?? '',
        descriptionPlain: (r.descriptionPlain as string) ?? null,
        descriptionHtml: (r.descriptionHtml as string) ?? null,
        descriptionSocial: (r.descriptionSocial as string) ?? null,
        descriptionParts: descParts
          ? {
              descriptionOpening: mapDescriptionPart(descParts.descriptionOpening),
              descriptionBody: mapDescriptionPart(descParts.descriptionBody),
              descriptionClosing: mapDescriptionPart(descParts.descriptionClosing),
            }
          : null,
        departmentName: (r.departmentName as string) ?? null,
        teamName: (r.teamName as string) ?? null,
        teamNameHierarchy: Array.isArray(r.teamNameHierarchy)
          ? (r.teamNameHierarchy as string[])
          : [],
        jobId: (r.jobId as string) ?? null,
        locationName: (r.locationName as string) ?? null,
        locationIds: r.locationIds
          ? {
              primaryLocationId: r.locationIds.primaryLocationId ?? null,
              secondaryLocationIds: Array.isArray(r.locationIds.secondaryLocationIds)
                ? r.locationIds.secondaryLocationIds
                : [],
            }
          : null,
        address: r.address
          ? {
              postalAddress: pa
                ? {
                    addressCountry: (pa.addressCountry as string) ?? null,
                    addressRegion: (pa.addressRegion as string) ?? null,
                    addressLocality: (pa.addressLocality as string) ?? null,
                    postalCode: (pa.postalCode as string) ?? null,
                    streetAddress: (pa.streetAddress as string) ?? null,
                  }
                : null,
            }
          : null,
        isRemote: (r.isRemote as boolean) ?? false,
        workplaceType: (r.workplaceType as string) ?? null,
        employmentType: (r.employmentType as string) ?? null,
        isListed: (r.isListed as boolean) ?? false,
        suppressDescriptionOpening: (r.suppressDescriptionOpening as boolean) ?? false,
        suppressDescriptionClosing: (r.suppressDescriptionClosing as boolean) ?? false,
        publishedDate: (r.publishedDate as string) ?? null,
        applicationDeadline: (r.applicationDeadline as string) ?? null,
        externalLink: (r.externalLink as string) ?? null,
        applyLink: (r.applyLink as string) ?? null,
        compensation: comp
          ? {
              compensationTierSummary: (comp.compensationTierSummary as string) ?? null,
              summaryComponents: summaryComponents.map((c) => ({
                summary: (c.summary as string) ?? null,
                compensationTypeLabel: (c.compensationTypeLabel as string) ?? null,
                interval: (c.interval as string) ?? null,
                currencyCode: (c.currencyCode as string) ?? null,
                minValue: (c.minValue as number) ?? null,
                maxValue: (c.maxValue as number) ?? null,
              })),
              shouldDisplayCompensationOnJobBoard:
                (comp.shouldDisplayCompensationOnJobBoard as boolean) ?? false,
            }
          : null,
        applicationLimitCalloutHtml: (r.applicationLimitCalloutHtml as string) ?? null,
        updatedAt: (r.updatedAt as string) ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Job posting UUID' },
    title: { type: 'string', description: 'Job posting title' },
    descriptionPlain: {
      type: 'string',
      description: 'Full description in plain text',
      optional: true,
    },
    descriptionHtml: {
      type: 'string',
      description: 'Full description in HTML',
      optional: true,
    },
    descriptionSocial: {
      type: 'string',
      description: 'Shortened description for social sharing (max 200 chars)',
      optional: true,
    },
    descriptionParts: {
      type: 'object',
      description: 'Description broken into opening, body, and closing sections',
      optional: true,
      properties: {
        descriptionOpening: {
          type: 'object',
          description: 'Opening (from Job Boards theme settings)',
          optional: true,
          properties: {
            html: { type: 'string', description: 'HTML content', optional: true },
            plain: { type: 'string', description: 'Plain text content', optional: true },
          },
        },
        descriptionBody: {
          type: 'object',
          description: 'Main description body',
          optional: true,
          properties: {
            html: { type: 'string', description: 'HTML content', optional: true },
            plain: { type: 'string', description: 'Plain text content', optional: true },
          },
        },
        descriptionClosing: {
          type: 'object',
          description: 'Closing (from Job Boards theme settings)',
          optional: true,
          properties: {
            html: { type: 'string', description: 'HTML content', optional: true },
            plain: { type: 'string', description: 'Plain text content', optional: true },
          },
        },
      },
    },
    departmentName: { type: 'string', description: 'Department name', optional: true },
    teamName: { type: 'string', description: 'Team name', optional: true },
    teamNameHierarchy: {
      type: 'array',
      description: 'Hierarchy of team names from root to team',
      items: { type: 'string', description: 'Team name' },
    },
    jobId: { type: 'string', description: 'Associated job UUID', optional: true },
    locationName: { type: 'string', description: 'Primary location name', optional: true },
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
    address: {
      type: 'object',
      description: 'Postal address of the posting location',
      optional: true,
      properties: {
        postalAddress: {
          type: 'object',
          description: 'Structured postal address',
          optional: true,
          properties: {
            addressCountry: { type: 'string', description: 'Country', optional: true },
            addressRegion: { type: 'string', description: 'State or region', optional: true },
            addressLocality: { type: 'string', description: 'City or locality', optional: true },
            postalCode: { type: 'string', description: 'Postal code', optional: true },
            streetAddress: { type: 'string', description: 'Street address', optional: true },
          },
        },
      },
    },
    isRemote: { type: 'boolean', description: 'Whether the posting is remote' },
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
    isListed: { type: 'boolean', description: 'Whether publicly listed on the job board' },
    suppressDescriptionOpening: {
      type: 'boolean',
      description: 'Whether the theme opening is hidden on this posting',
    },
    suppressDescriptionClosing: {
      type: 'boolean',
      description: 'Whether the theme closing is hidden on this posting',
    },
    publishedDate: { type: 'string', description: 'ISO 8601 published date', optional: true },
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
      description: 'Direct apply link',
      optional: true,
    },
    compensation: {
      type: 'object',
      description: 'Compensation details for the posting',
      optional: true,
      properties: {
        compensationTierSummary: {
          type: 'string',
          description: 'Human-readable tier summary',
          optional: true,
        },
        summaryComponents: {
          type: 'array',
          description: 'Structured compensation components',
          items: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'Component summary', optional: true },
              compensationTypeLabel: {
                type: 'string',
                description: 'Component type label (Salary, Commission, Bonus, Equity, etc.)',
                optional: true,
              },
              interval: {
                type: 'string',
                description: 'Payment interval (e.g. annual, hourly)',
                optional: true,
              },
              currencyCode: {
                type: 'string',
                description: 'ISO 4217 currency code',
                optional: true,
              },
              minValue: { type: 'number', description: 'Minimum value', optional: true },
              maxValue: { type: 'number', description: 'Maximum value', optional: true },
            },
          },
        },
        shouldDisplayCompensationOnJobBoard: {
          type: 'boolean',
          description: 'Whether compensation is shown on the job board',
        },
      },
    },
    applicationLimitCalloutHtml: {
      type: 'string',
      description: 'HTML callout shown when application limit is reached',
      optional: true,
    },
    updatedAt: {
      type: 'string',
      description: 'ISO 8601 last update timestamp',
      optional: true,
    },
  },
}
