import type { PdlCleanLocationParams, PdlCleanLocationResponse } from '@/tools/peopledatalabs/types'
import { PDL_LOCATION_OUTPUT_PROPERTIES } from '@/tools/peopledatalabs/types'
import { projectLocation } from '@/tools/peopledatalabs/utils'
import type { ToolConfig } from '@/tools/types'

export const cleanLocationTool: ToolConfig<PdlCleanLocationParams, PdlCleanLocationResponse> = {
  id: 'pdl_clean_location',
  name: 'PDL Location Cleaner',
  description:
    'Normalize a freeform location string into a structured locality/region/country record with coordinates.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    location: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Raw location string (e.g., "SF, CA")',
    },
  },

  request: {
    url: () => 'https://api.peopledatalabs.com/v5/location/clean',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({ location: params.location }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as Record<string, unknown>
    const status = (data.status as number) ?? response.status

    if (status === 404) {
      return { success: true, output: { matched: false, location: null } }
    }

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const hasFields = data.name || data.locality || data.country
    return {
      success: true,
      output: {
        matched: Boolean(hasFields),
        location: hasFields ? projectLocation(data) : null,
      },
    }
  },

  outputs: {
    matched: { type: 'boolean', description: 'Whether the input was matched to a known location' },
    location: {
      type: 'object',
      description: 'Canonical location record',
      optional: true,
      properties: PDL_LOCATION_OUTPUT_PROPERTIES,
    },
  },
}
