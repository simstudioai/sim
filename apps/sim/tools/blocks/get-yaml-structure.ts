import type { ToolConfig, ToolResponse } from '@/tools/types'

type GetYamlStructureParams = Record<string, never>

interface GetYamlStructureResult {
  guide: string
  message: string
}

interface GetYamlStructureResponse extends ToolResponse {
  output: GetYamlStructureResult
}

export const getYamlStructureTool: ToolConfig<GetYamlStructureParams, GetYamlStructureResponse> = {
  id: 'get_yaml_structure',
  name: 'Get YAML Workflow Structure Guide',
  description:
    'Get comprehensive YAML workflow syntax guide and examples to understand how to structure Sim Studio workflows',
  version: '1.0.0',

  params: {},

  request: {
    url: '/api/tools/get-yaml-structure',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<GetYamlStructureResponse> => {
    if (!response.ok) {
      throw new Error(`Get YAML structure failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to get YAML structure guide')
    }

    return {
      success: true,
      output: data.data,
    }
  },

  transformError: (error: any): string => {
    if (error instanceof Error) {
      return `Failed to get YAML structure guide: ${error.message}`
    }
    return 'An unexpected error occurred while getting YAML structure guide'
  },
}
