import {
  type CheckrProgramIdParams,
  type CheckrProgramResponse,
  PROGRAM_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapProgram,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetProgramTool: ToolConfig<CheckrProgramIdParams, CheckrProgramResponse> = {
  id: 'checkr_get_program',
  name: 'Checkr Get Program',
  description: 'Retrieve a program by ID, including its package and geo IDs.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    programId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the program',
    },
  },

  request: {
    url: (params) => checkrUrl(`/programs/${checkrId(params.programId, 'programId')}`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { program: mapProgram(data) } }
  },

  outputs: {
    program: { type: 'object', description: 'The program', properties: PROGRAM_PROPERTIES },
  },
}
