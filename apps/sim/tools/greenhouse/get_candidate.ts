import type {
  GreenhouseGetCandidateParams,
  GreenhouseGetCandidateResponse,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseGetCandidateTool: ToolConfig<
  GreenhouseGetCandidateParams,
  GreenhouseGetCandidateResponse
> = {
  id: 'greenhouse_get_candidate',
  name: 'Greenhouse Get Candidate',
  description:
    'Retrieves a specific candidate by ID with full details including contact info, education, and employment history',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greenhouse Harvest API key',
    },
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the candidate to retrieve',
    },
  },

  request: {
    url: (params: GreenhouseGetCandidateParams) =>
      `https://harvest.greenhouse.io/v1/candidates/${params.candidateId.trim()}`,
    method: 'GET',
    headers: (params: GreenhouseGetCandidateParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseGetCandidateResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: {
          id: 0,
          first_name: null,
          last_name: null,
          company: null,
          title: null,
          is_private: false,
          can_email: false,
          created_at: null,
          updated_at: null,
          last_activity: null,
          email_addresses: [],
          phone_numbers: [],
          addresses: [],
          website_addresses: [],
          social_media_addresses: [],
          tags: [],
          application_ids: [],
          recruiter: null,
          coordinator: null,
          attachments: [],
          educations: [],
          employments: [],
          custom_fields: {},
        },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const c = await response.json()
    return {
      success: true,
      output: {
        id: c.id ?? 0,
        first_name: c.first_name ?? null,
        last_name: c.last_name ?? null,
        company: c.company ?? null,
        title: c.title ?? null,
        is_private: c.is_private ?? false,
        can_email: c.can_email ?? false,
        created_at: c.created_at ?? null,
        updated_at: c.updated_at ?? null,
        last_activity: c.last_activity ?? null,
        email_addresses: c.email_addresses ?? [],
        phone_numbers: c.phone_numbers ?? [],
        addresses: c.addresses ?? [],
        website_addresses: c.website_addresses ?? [],
        social_media_addresses: c.social_media_addresses ?? [],
        tags: c.tags ?? [],
        application_ids: c.application_ids ?? [],
        recruiter: c.recruiter ?? null,
        coordinator: c.coordinator ?? null,
        attachments: (c.attachments ?? []).map((a: Record<string, unknown>) => ({
          filename: a.filename ?? '',
          url: a.url ?? '',
          type: a.type ?? '',
          created_at: (a.created_at as string) ?? null,
        })),
        educations: (c.educations ?? []).map((e: Record<string, unknown>) => ({
          id: e.id ?? 0,
          school_name: e.school_name ?? null,
          degree: e.degree ?? null,
          discipline: e.discipline ?? null,
          start_date: (e.start_date as string) ?? null,
          end_date: (e.end_date as string) ?? null,
        })),
        employments: (c.employments ?? []).map((e: Record<string, unknown>) => ({
          id: e.id ?? 0,
          company_name: e.company_name ?? null,
          title: e.title ?? null,
          start_date: (e.start_date as string) ?? null,
          end_date: (e.end_date as string) ?? null,
        })),
        custom_fields: c.custom_fields ?? {},
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Candidate ID' },
    first_name: { type: 'string', description: 'First name' },
    last_name: { type: 'string', description: 'Last name' },
    company: { type: 'string', description: 'Current employer', optional: true },
    title: { type: 'string', description: 'Current job title', optional: true },
    is_private: { type: 'boolean', description: 'Whether candidate is private' },
    can_email: { type: 'boolean', description: 'Whether candidate can be emailed' },
    created_at: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
    updated_at: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
    last_activity: {
      type: 'string',
      description: 'Last activity timestamp (ISO 8601)',
      optional: true,
    },
    email_addresses: {
      type: 'array',
      description: 'Email addresses',
      items: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'Email address' },
          type: { type: 'string', description: 'Type (personal, work, other)' },
        },
      },
    },
    phone_numbers: {
      type: 'array',
      description: 'Phone numbers',
      items: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'Phone number' },
          type: { type: 'string', description: 'Type (home, work, mobile, skype, other)' },
        },
      },
    },
    addresses: {
      type: 'array',
      description: 'Addresses',
      items: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'Address' },
          type: { type: 'string', description: 'Type (home, work, other)' },
        },
      },
    },
    website_addresses: {
      type: 'array',
      description: 'Website addresses',
      items: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'URL' },
          type: { type: 'string', description: 'Type (personal, company, portfolio, blog, other)' },
        },
      },
    },
    social_media_addresses: {
      type: 'array',
      description: 'Social media profiles',
      items: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'URL or handle' },
        },
      },
    },
    tags: { type: 'array', description: 'Tags', items: { type: 'string', description: 'Tag' } },
    application_ids: {
      type: 'array',
      description: 'Associated application IDs',
      items: { type: 'number', description: 'Application ID' },
    },
    recruiter: {
      type: 'object',
      description: 'Assigned recruiter',
      optional: true,
      properties: {
        id: { type: 'number', description: 'User ID' },
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
        name: { type: 'string', description: 'Full name' },
        employee_id: { type: 'string', description: 'Employee ID', optional: true },
      },
    },
    coordinator: {
      type: 'object',
      description: 'Assigned coordinator',
      optional: true,
      properties: {
        id: { type: 'number', description: 'User ID' },
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
        name: { type: 'string', description: 'Full name' },
        employee_id: { type: 'string', description: 'Employee ID', optional: true },
      },
    },
    attachments: {
      type: 'array',
      description: 'File attachments (URLs expire after 7 days)',
      items: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'File name' },
          url: { type: 'string', description: 'Download URL (expires after 7 days)' },
          type: { type: 'string', description: 'Type (resume, cover_letter, offer_packet, other)' },
          created_at: { type: 'string', description: 'Upload timestamp', optional: true },
        },
      },
    },
    educations: {
      type: 'array',
      description: 'Education history',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Education record ID' },
          school_name: { type: 'string', description: 'School name', optional: true },
          degree: { type: 'string', description: 'Degree type', optional: true },
          discipline: { type: 'string', description: 'Field of study', optional: true },
          start_date: { type: 'string', description: 'Start date (ISO 8601)', optional: true },
          end_date: { type: 'string', description: 'End date (ISO 8601)', optional: true },
        },
      },
    },
    employments: {
      type: 'array',
      description: 'Employment history',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Employment record ID' },
          company_name: { type: 'string', description: 'Company name', optional: true },
          title: { type: 'string', description: 'Job title', optional: true },
          start_date: { type: 'string', description: 'Start date (ISO 8601)', optional: true },
          end_date: { type: 'string', description: 'End date (ISO 8601)', optional: true },
        },
      },
    },
    custom_fields: { type: 'object', description: 'Custom field values' },
  },
}
