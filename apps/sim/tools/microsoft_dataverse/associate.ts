import { createLogger } from '@sim/logger'
import type {
  DataverseAssociateParams,
  DataverseAssociateResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseAssociate')

export const dataverseAssociateTool: ToolConfig<
  DataverseAssociateParams,
  DataverseAssociateResponse
> = {
  id: 'microsoft_dataverse_associate',
  name: 'Associate Microsoft Dataverse Records',
  description:
    'Associate two records in Microsoft Dataverse via a navigation property. Creates a relationship between a source record and a target record. Supports both collection-valued (POST) and single-valued (PUT) navigation properties.',
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
    entitySetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source entity set name (e.g., accounts)',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source record GUID',
    },
    navigationProperty: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Navigation property name (e.g., contact_customer_accounts for collection-valued, or parentcustomerid_account for single-valued)',
    },
    targetEntitySetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target entity set name (e.g., contacts)',
    },
    targetRecordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target record GUID to associate',
    },
    navigationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Type of navigation property: "collection" (default, uses POST) or "single" (uses PUT for lookup fields)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}(${params.recordId})/${params.navigationProperty}/$ref`
    },
    method: (params) => (params.navigationType === 'single' ? 'PUT' : 'POST'),
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
    body: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return {
        '@odata.id': `${baseUrl}/api/data/v9.2/${params.targetEntitySetName}(${params.targetRecordId})`,
      }
    },
  },

  transformResponse: async (response: Response, params?: DataverseAssociateParams) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse associate failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        success: true,
        entitySetName: params?.entitySetName ?? '',
        recordId: params?.recordId ?? '',
        navigationProperty: params?.navigationProperty ?? '',
        targetEntitySetName: params?.targetEntitySetName ?? '',
        targetRecordId: params?.targetRecordId ?? '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the association was created successfully' },
    entitySetName: {
      type: 'string',
      description: 'Source entity set name used in the association',
    },
    recordId: { type: 'string', description: 'Source record GUID that was associated' },
    navigationProperty: {
      type: 'string',
      description: 'Navigation property used for the association',
    },
    targetEntitySetName: {
      type: 'string',
      description: 'Target entity set name used in the association',
    },
    targetRecordId: { type: 'string', description: 'Target record GUID that was associated' },
  },
}
