import type {
  GreenhouseGetApplicationParams,
  GreenhouseGetApplicationResponse,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseGetApplicationTool: ToolConfig<
  GreenhouseGetApplicationParams,
  GreenhouseGetApplicationResponse
> = {
  id: 'greenhouse_get_application',
  name: 'Greenhouse Get Application',
  description:
    'Retrieves a specific application by ID with full details including source, stage, answers, and attachments',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greenhouse Harvest API key',
    },
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the application to retrieve',
    },
  },

  request: {
    url: (params: GreenhouseGetApplicationParams) =>
      `https://harvest.greenhouse.io/v1/applications/${params.applicationId.trim()}`,
    method: 'GET',
    headers: (params: GreenhouseGetApplicationParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseGetApplicationResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: {
          id: 0,
          candidate_id: 0,
          prospect: false,
          status: null,
          applied_at: null,
          rejected_at: null,
          last_activity_at: null,
          location: null,
          source: null,
          credited_to: null,
          recruiter: null,
          coordinator: null,
          current_stage: null,
          rejection_reason: null,
          jobs: [],
          job_post_id: null,
          answers: [],
          attachments: [],
          custom_fields: {},
        },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const a = await response.json()
    return {
      success: true,
      output: {
        id: a.id ?? 0,
        candidate_id: a.candidate_id ?? 0,
        prospect: a.prospect ?? false,
        status: a.status ?? null,
        applied_at: a.applied_at ?? null,
        rejected_at: a.rejected_at ?? null,
        last_activity_at: a.last_activity_at ?? null,
        location: a.location ?? null,
        source: a.source ?? null,
        credited_to: a.credited_to ?? null,
        recruiter: a.recruiter ?? null,
        coordinator: a.coordinator ?? null,
        current_stage: a.current_stage ?? null,
        rejection_reason: a.rejection_reason ?? null,
        jobs: a.jobs ?? [],
        job_post_id: a.job_post_id ?? null,
        answers: a.answers ?? [],
        attachments: (a.attachments ?? []).map((att: Record<string, unknown>) => ({
          filename: att.filename ?? '',
          url: att.url ?? '',
          type: att.type ?? '',
          created_at: (att.created_at as string) ?? null,
        })),
        custom_fields: a.custom_fields ?? {},
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Application ID' },
    candidate_id: { type: 'number', description: 'Associated candidate ID' },
    prospect: { type: 'boolean', description: 'Whether this is a prospect application' },
    status: { type: 'string', description: 'Status (active, converted, hired, rejected)' },
    applied_at: { type: 'string', description: 'Application date (ISO 8601)' },
    rejected_at: { type: 'string', description: 'Rejection date (ISO 8601)', optional: true },
    last_activity_at: { type: 'string', description: 'Last activity date (ISO 8601)' },
    location: {
      type: 'object',
      description: 'Candidate location',
      optional: true,
      properties: {
        address: { type: 'string', description: 'Location address', optional: true },
      },
    },
    source: {
      type: 'object',
      description: 'Application source',
      optional: true,
      properties: {
        id: { type: 'number', description: 'Source ID' },
        public_name: { type: 'string', description: 'Source name' },
      },
    },
    credited_to: {
      type: 'object',
      description: 'User credited for the application',
      optional: true,
      properties: {
        id: { type: 'number', description: 'User ID' },
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
        name: { type: 'string', description: 'Full name' },
        employee_id: { type: 'string', description: 'Employee ID', optional: true },
      },
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
    current_stage: {
      type: 'object',
      description: 'Current interview stage (null when hired)',
      optional: true,
      properties: {
        id: { type: 'number', description: 'Stage ID' },
        name: { type: 'string', description: 'Stage name' },
      },
    },
    rejection_reason: {
      type: 'object',
      description: 'Rejection reason',
      optional: true,
      properties: {
        id: { type: 'number', description: 'Rejection reason ID' },
        name: { type: 'string', description: 'Rejection reason name' },
        type: {
          type: 'object',
          description: 'Rejection reason type',
          properties: {
            id: { type: 'number', description: 'Type ID' },
            name: { type: 'string', description: 'Type name' },
          },
        },
      },
    },
    jobs: {
      type: 'array',
      description: 'Associated jobs',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Job ID' },
          name: { type: 'string', description: 'Job name' },
        },
      },
    },
    job_post_id: { type: 'number', description: 'Job post ID', optional: true },
    answers: {
      type: 'array',
      description: 'Application question answers',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question text' },
          answer: { type: 'string', description: 'Answer text' },
        },
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
    custom_fields: { type: 'object', description: 'Custom field values' },
  },
}
