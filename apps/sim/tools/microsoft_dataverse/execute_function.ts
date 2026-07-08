import { createLogger } from '@sim/logger'
import type {
  DataverseExecuteFunctionParams,
  DataverseExecuteFunctionResponse,
} from '@/tools/microsoft_dataverse/types'
import { getDataverseBaseUrl } from '@/tools/microsoft_dataverse/utils'
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
        'Function parameters for the URL. Simple values can be inlined (e.g., "LocalizedStandardName=\'Pacific Standard Time\',LocaleId=1033"), but values with reserved characters (/ < > * % & : \\ ? +) must use parameter aliases: put the alias assignment in parentheses and the alias-to-value bindings after a "?", e.g. "LocalizedStandardName=@p1,LocaleId=@p2?@p1=\'Pacific Standard Time\'&@p2=1033". Do not include the enclosing parentheses yourself.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDataverseBaseUrl(params.environmentUrl)
      const functionName = params.functionName.trim()
      const rawParams = params.parameters?.trim() ?? ''
      const separatorIndex = rawParams.indexOf('?')
      const inlineParams = separatorIndex === -1 ? rawParams : rawParams.slice(0, separatorIndex)
      const aliasQuery = separatorIndex === -1 ? '' : rawParams.slice(separatorIndex + 1)
      const paramStr = inlineParams ? `(${inlineParams})` : '()'
      const querySuffix = aliasQuery ? `?${aliasQuery}` : ''
      if (params.entitySetName) {
        const entitySetName = params.entitySetName.trim()
        if (params.recordId) {
          return `${baseUrl}/api/data/v9.2/${entitySetName}(${params.recordId.trim()})/Microsoft.Dynamics.CRM.${functionName}${paramStr}${querySuffix}`
        }
        return `${baseUrl}/api/data/v9.2/${entitySetName}/Microsoft.Dynamics.CRM.${functionName}${paramStr}${querySuffix}`
      }
      return `${baseUrl}/api/data/v9.2/${functionName}${paramStr}${querySuffix}`
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
