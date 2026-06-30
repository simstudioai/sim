import {
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_CORE_BASE_URL,
  type SportmonksTypesByEntity,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTypeByEntityParams extends SportmonksBaseParams {}

export interface SportmonksGetTypeByEntityResponse extends ToolResponse {
  output: {
    typesByEntity: SportmonksTypesByEntity | null
  }
}

export const sportmonksCoreGetTypeByEntityTool: ToolConfig<
  SportmonksGetTypeByEntityParams,
  SportmonksGetTypeByEntityResponse
> = {
  id: 'sportmonks_core_get_type_by_entity',
  name: 'Get Type by Entity',
  description: 'Retrieve the available types grouped per entity from the Sportmonks Core API',
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
    url: () => `${SPORTMONKS_CORE_BASE_URL}/types/entities`,
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_type_by_entity')
    }
    return {
      success: true,
      output: {
        typesByEntity: data.data ?? null,
      },
    }
  },

  outputs: {
    typesByEntity: {
      type: 'json',
      description:
        'Map of entity name to its available types, e.g. {CoachStatisticDetail: {updated_at, types: [{id, name, code, developer_name, model_type, stat_group}]}}',
    },
  },
}
