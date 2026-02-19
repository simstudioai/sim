import { createLogger } from '@sim/logger'
import type {
  DataverseDisassociateParams,
  DataverseDisassociateResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseDisassociate')

export const dataverseDisassociateTool: ToolConfig<
  DataverseDisassociateParams,
  DataverseDisassociateResponse
> = {
  id: 'microsoft_dataverse_disassociate',
  name: 'Disassociate Microsoft Dataverse Records',
  description:
    'Remove an association between two records in Microsoft Dataverse. For collection-valued navigation properties, provide the target record ID. For single-valued navigation properties, only the navigation property name is needed.',
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
    targetRecordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Target record GUID (required for collection-valued navigation properties, omit for single-valued)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      if (params.targetRecordId) {
        return `${baseUrl}/api/data/v9.2/${params.entitySetName}(${params.recordId})/${params.navigationProperty}(${params.targetRecordId})/$ref`
      }
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}(${params.recordId})/${params.navigationProperty}/$ref`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: DataverseDisassociateParams) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse disassociate failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        success: true,
        entitySetName: params?.entitySetName ?? '',
        recordId: params?.recordId ?? '',
        navigationProperty: params?.navigationProperty ?? '',
        ...(params?.targetRecordId ? { targetRecordId: params.targetRecordId } : {}),
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the disassociation was completed successfully',
    },
    entitySetName: {
      type: 'string',
      description: 'Source entity set name used in the disassociation',
    },
    recordId: { type: 'string', description: 'Source record GUID that was disassociated' },
    navigationProperty: {
      type: 'string',
      description: 'Navigation property used for the disassociation',
    },
    targetRecordId: {
      type: 'string',
      description: 'Target record GUID that was disassociated',
      optional: true,
    },
  },
}
