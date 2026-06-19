import {
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import { SPORTMONKS_CORE_BASE_URL } from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTimezonesParams extends SportmonksBaseParams {}

export interface SportmonksGetTimezonesResponse extends ToolResponse {
  output: {
    timezones: string[]
  }
}

export const sportmonksCoreGetTimezonesTool: ToolConfig<
  SportmonksGetTimezonesParams,
  SportmonksGetTimezonesResponse
> = {
  id: 'sportmonks_core_get_timezones',
  name: 'Get Timezones',
  description: 'Retrieve all supported time zones (IANA names) from the Sportmonks Core API',
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
    url: () => `${SPORTMONKS_CORE_BASE_URL}/timezones`,
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_timezones')
    }
    return {
      success: true,
      output: {
        timezones: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    timezones: {
      type: 'array',
      description: 'Array of supported IANA time zone names (e.g. Europe/London)',
      items: { type: 'string', description: 'IANA time zone name' },
    },
  },
}
