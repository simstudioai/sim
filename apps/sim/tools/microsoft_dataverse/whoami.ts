import { createLogger } from '@sim/logger'
import type {
  DataverseWhoAmIParams,
  DataverseWhoAmIResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseWhoAmI')

export const dataverseWhoAmITool: ToolConfig<DataverseWhoAmIParams, DataverseWhoAmIResponse> = {
  id: 'microsoft_dataverse_whoami',
  name: 'Microsoft Dataverse WhoAmI',
  description:
    'Retrieve the current authenticated user information from Microsoft Dataverse. Useful for testing connectivity and getting the user ID, business unit ID, and organization ID.',
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
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return `${baseUrl}/api/data/v9.2/WhoAmI()`
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
      logger.error('Dataverse WhoAmI failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        userId: data.UserId ?? '',
        businessUnitId: data.BusinessUnitId ?? '',
        organizationId: data.OrganizationId ?? '',
        success: true,
      },
    }
  },

  outputs: {
    userId: { type: 'string', description: 'The authenticated user ID' },
    businessUnitId: { type: 'string', description: 'The business unit ID' },
    organizationId: { type: 'string', description: 'The organization ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
