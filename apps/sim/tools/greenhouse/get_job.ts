import type { GreenhouseGetJobParams, GreenhouseGetJobResponse } from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseGetJobTool: ToolConfig<GreenhouseGetJobParams, GreenhouseGetJobResponse> = {
  id: 'greenhouse_get_job',
  name: 'Greenhouse Get Job',
  description:
    'Retrieves a specific job by ID with full details including hiring team, openings, and custom fields',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greenhouse Harvest API key',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the job to retrieve',
    },
  },

  request: {
    url: (params: GreenhouseGetJobParams) =>
      `https://harvest.greenhouse.io/v1/jobs/${params.jobId.trim()}`,
    method: 'GET',
    headers: (params: GreenhouseGetJobParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseGetJobResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: {
          id: 0,
          name: null,
          requisition_id: null,
          status: null,
          confidential: false,
          created_at: null,
          opened_at: null,
          closed_at: null,
          updated_at: null,
          is_template: null,
          notes: null,
          departments: [],
          offices: [],
          hiring_team: { hiring_managers: [], recruiters: [], coordinators: [], sourcers: [] },
          openings: [],
          custom_fields: {},
        },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const j = await response.json()
    return {
      success: true,
      output: {
        id: j.id ?? 0,
        name: j.name ?? null,
        requisition_id: j.requisition_id ?? null,
        status: j.status ?? null,
        confidential: j.confidential ?? false,
        created_at: j.created_at ?? null,
        opened_at: j.opened_at ?? null,
        closed_at: j.closed_at ?? null,
        updated_at: j.updated_at ?? null,
        is_template: j.is_template ?? null,
        notes: j.notes ?? null,
        departments: (j.departments ?? []).map((d: Record<string, unknown>) => ({
          id: d.id ?? 0,
          name: (d.name as string) ?? '',
          parent_id: (d.parent_id as number) ?? null,
        })),
        offices: (j.offices ?? []).map((o: Record<string, unknown>) => ({
          id: o.id ?? 0,
          name: (o.name as string) ?? '',
          location: { name: ((o.location as Record<string, unknown>)?.name as string) ?? null },
        })),
        hiring_team: {
          hiring_managers: j.hiring_team?.hiring_managers ?? [],
          recruiters: j.hiring_team?.recruiters ?? [],
          coordinators: j.hiring_team?.coordinators ?? [],
          sourcers: j.hiring_team?.sourcers ?? [],
        },
        openings: (j.openings ?? []).map((o: Record<string, unknown>) => ({
          id: o.id ?? 0,
          opening_id: (o.opening_id as string) ?? null,
          status: (o.status as string) ?? 'open',
          opened_at: (o.opened_at as string) ?? null,
          closed_at: (o.closed_at as string) ?? null,
          application_id: (o.application_id as number) ?? null,
          close_reason: (o.close_reason as { id: number; name: string }) ?? null,
        })),
        custom_fields: j.custom_fields ?? {},
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Job ID' },
    name: { type: 'string', description: 'Job title' },
    requisition_id: { type: 'string', description: 'External requisition ID', optional: true },
    status: { type: 'string', description: 'Job status (open, closed, draft)' },
    confidential: { type: 'boolean', description: 'Whether the job is confidential' },
    created_at: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
    opened_at: { type: 'string', description: 'Date job was opened (ISO 8601)', optional: true },
    closed_at: { type: 'string', description: 'Date job was closed (ISO 8601)', optional: true },
    updated_at: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
    is_template: { type: 'boolean', description: 'Whether this is a job template', optional: true },
    notes: { type: 'string', description: 'Hiring plan notes (may contain HTML)', optional: true },
    departments: {
      type: 'array',
      description: 'Associated departments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Department ID' },
          name: { type: 'string', description: 'Department name' },
          parent_id: { type: 'number', description: 'Parent department ID', optional: true },
        },
      },
    },
    offices: {
      type: 'array',
      description: 'Associated offices',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Office ID' },
          name: { type: 'string', description: 'Office name' },
          location: {
            type: 'object',
            description: 'Office location',
            properties: {
              name: { type: 'string', description: 'Location name', optional: true },
            },
          },
        },
      },
    },
    hiring_team: {
      type: 'object',
      description: 'Hiring team members',
      properties: {
        hiring_managers: { type: 'array', description: 'Hiring managers' },
        recruiters: { type: 'array', description: 'Recruiters (includes responsible flag)' },
        coordinators: { type: 'array', description: 'Coordinators (includes responsible flag)' },
        sourcers: { type: 'array', description: 'Sourcers' },
      },
    },
    openings: {
      type: 'array',
      description: 'Job openings/slots',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Opening internal ID' },
          opening_id: { type: 'string', description: 'Custom opening identifier', optional: true },
          status: { type: 'string', description: 'Opening status (open, closed)' },
          opened_at: { type: 'string', description: 'Date opened (ISO 8601)', optional: true },
          closed_at: { type: 'string', description: 'Date closed (ISO 8601)', optional: true },
          application_id: { type: 'number', description: 'Hired application ID', optional: true },
          close_reason: {
            type: 'object',
            description: 'Reason for closing',
            optional: true,
            properties: {
              id: { type: 'number', description: 'Close reason ID' },
              name: { type: 'string', description: 'Close reason name' },
            },
          },
        },
      },
    },
    custom_fields: { type: 'object', description: 'Custom field values' },
  },
}
