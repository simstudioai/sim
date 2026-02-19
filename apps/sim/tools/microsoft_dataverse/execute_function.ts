import { createLogger } from '@sim/logger'
import type {
  DataverseExecuteFunctionParams,
  DataverseExecuteFunctionResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseExecuteFunction')

export const dataverseExecuteFunctionTool: ToolConfig<
  DataverseExecuteFunctionParams,
  DataverseExecuteFunctionResponse
> = {
  id: 'microsoft_dataverse_execute_function',
  name: 'Execute Microsoft Dataverse Function',
  description:
    'Execute a bound or unbound Dataverse function. Functions are read-only operations (e.g., RetrievePrincipalAccess, RetrieveTotalRecordCount, InitializeFrom). For bound functions, provide the entity set name and record ID.',
  version: '1.0.0',

  oauth: { required: true, provider: 'microsoft-dataverse' },
  errorExtractor: 'nested-error-object',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Microsoft Dataverse API',
    },
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dataverse environment URL (e.g., https://myorg.crm.dynamics.com)',
    },
    functionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Function name (e.g., RetrievePrincipalAccess, RetrieveTotalRecordCount). Do not include the Microsoft.Dynamics.CRM. namespace prefix for unbound functions.',
    },
    entitySetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Entity set name for bound functions (e.g., systemusers). Leave empty for unbound functions.',
    },
    recordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Record GUID for bound functions. Leave empty for unbound functions.',
    },
    parameters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Function parameters as a comma-separated list of name=value pairs for the URL (e.g., "LocalizedStandardName=\'Pacific Standard Time\',LocaleId=1033"). Use @p1,@p2 aliases for complex values.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      const paramStr = params.parameters ? `(${params.parameters})` : '()'
      if (params.entitySetName) {
        if (params.recordId) {
          return `${baseUrl}/api/data/v9.2/${params.entitySetName}(${params.recordId})/Microsoft.Dynamics.CRM.${params.functionName}${paramStr}`
        }
        return `${baseUrl}/api/data/v9.2/${params.entitySetName}/Microsoft.Dynamics.CRM.${params.functionName}${paramStr}`
      }
      return `${baseUrl}/api/data/v9.2/${params.functionName}${paramStr}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse execute function failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json().catch(() => null)

    return {
      success: true,
      output: {
        result: data,
        success: true,
      },
    }
  },

  outputs: {
    result: {
      type: 'object',
      description: 'Function response data. Structure varies by function.',
      optional: true,
    },
    success: { type: 'boolean', description: 'Whether the function executed successfully' },
  },
}
