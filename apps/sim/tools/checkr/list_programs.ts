import {
  type CheckrListProgramsParams,
  type CheckrListProgramsResponse,
  LIST_META_OUTPUTS,
  PROGRAM_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrPaginationQuery,
  checkrUrl,
  mapListMeta,
  mapProgram,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListProgramsTool: ToolConfig<
  CheckrListProgramsParams,
  CheckrListProgramsResponse
> = {
  id: 'checkr_list_programs',
  name: 'Checkr List Programs',
  description: 'List programs, which group packages and geos, optionally filtered by name.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return programs with this name',
    },
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl('/programs', { name: params.name, ...checkrPaginationQuery(params) }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        programs: (Array.isArray(data.data) ? data.data : []).map(mapProgram),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    programs: {
      type: 'array',
      description: 'Matching programs',
      items: { type: 'object', properties: PROGRAM_PROPERTIES },
    },
    ...LIST_META_OUTPUTS,
  },
}
