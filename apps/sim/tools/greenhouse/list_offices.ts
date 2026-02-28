import type {
  GreenhouseListOfficesParams,
  GreenhouseListOfficesResponse,
  GreenhouseOffice,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListOfficesTool: ToolConfig<
  GreenhouseListOfficesParams,
  GreenhouseListOfficesResponse
> = {
  id: 'greenhouse_list_offices',
  name: 'Greenhouse List Offices',
  description: 'Lists all offices configured in Greenhouse',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greenhouse Harvest API key',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (1-500, default 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params: GreenhouseListOfficesParams) => {
      const url = new URL('https://harvest.greenhouse.io/v1/offices')
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params: GreenhouseListOfficesParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseListOfficesResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { offices: [], count: 0 },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json()
    const offices: GreenhouseOffice[] = (Array.isArray(data) ? data : []).map(
      (o: Record<string, unknown>) => ({
        id: (o.id as number) ?? 0,
        name: (o.name as string) ?? null,
        location: {
          name: ((o.location as Record<string, unknown>)?.name as string) ?? null,
        },
        primary_contact_user_id: (o.primary_contact_user_id as number) ?? null,
        parent_id: (o.parent_id as number) ?? null,
        child_ids: (o.child_ids as number[]) ?? [],
        external_id: (o.external_id as string) ?? null,
      })
    )
    return {
      success: true,
      output: { offices, count: offices.length },
    }
  },

  outputs: {
    offices: {
      type: 'array',
      description: 'List of offices',
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
          primary_contact_user_id: {
            type: 'number',
            description: 'Primary contact user ID',
            optional: true,
          },
          parent_id: { type: 'number', description: 'Parent office ID', optional: true },
          child_ids: {
            type: 'array',
            description: 'Child office IDs',
            items: { type: 'number', description: 'Office ID' },
          },
          external_id: { type: 'string', description: 'External system ID', optional: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of offices returned' },
  },
}
