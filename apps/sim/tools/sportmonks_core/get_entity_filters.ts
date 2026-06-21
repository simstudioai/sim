import {
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import { SPORTMONKS_MY_BASE_URL, type SportmonksEntityFilters } from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetEntityFiltersParams extends SportmonksBaseParams {}

export interface SportmonksGetEntityFiltersResponse extends ToolResponse {
  output: {
    entityFilters: SportmonksEntityFilters | null
  }
}

export const sportmonksCoreGetEntityFiltersTool: ToolConfig<
  SportmonksGetEntityFiltersParams,
  SportmonksGetEntityFiltersResponse
> = {
  id: 'sportmonks_core_get_entity_filters',
  name: 'Get All Entity Filters',
  description: 'Retrieve all available filters grouped per entity from the Sportmonks Core API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
  },

  request: {
    url: () => `${SPORTMONKS_MY_BASE_URL}/filters/entity`,
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_entity_filters')
    }
    return {
      success: true,
      output: {
        entityFilters: data.data ?? null,
      },
    }
  },

  outputs: {
    entityFilters: {
      type: 'json',
      description:
        'Map of entity name to its available filter names, e.g. {fixture: ["fixtureLeagues", "fixtureSeasons"], event: ["eventTypes"]}',
    },
  },
}
