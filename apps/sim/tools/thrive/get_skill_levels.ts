import type { ThriveGetSkillLevelsParams, ThriveSkillLevelsResponse } from '@/tools/thrive/types'
import { THRIVE_SKILL_LEVEL_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getSkillLevelsTool: ToolConfig<ThriveGetSkillLevelsParams, ThriveSkillLevelsResponse> =
  {
    id: 'thrive_get_skill_levels',
    name: 'Thrive Get Skill Levels',
    description: 'Get the available skill levels configured in Thrive.',
    version: '1.0.0',

    params: {
      tenantId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Thrive Tenant ID (used as the Basic auth username)',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Thrive API key (used as the Basic auth password)',
      },
      host: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Region-specific API host',
      },
    },

    request: {
      url: (params) => `${getThriveBaseUrl(params.host, 'v1')}/skills/levels`,
      method: 'GET',
      headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    },

    transformResponse: async (response: Response): Promise<ThriveSkillLevelsResponse> => {
      const data = await parseThriveResponse(response, 'Failed to get skill levels')
      return { success: true, output: { levels: Array.isArray(data) ? data : [] } }
    },

    outputs: {
      levels: {
        type: 'array',
        description: 'The available skill levels',
        items: { type: 'object', properties: THRIVE_SKILL_LEVEL_OUTPUT_PROPERTIES },
      },
    },
  }
