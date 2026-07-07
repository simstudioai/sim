import { createLogger } from '@sim/logger'
import type {
  DataverseGetEntityMetadataParams,
  DataverseGetEntityMetadataResponse,
} from '@/tools/microsoft_dataverse/types'
import { getDataverseBaseUrl } from '@/tools/microsoft_dataverse/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseGetEntityMetadata')

const DEFAULT_ATTRIBUTE_SELECT =
  'LogicalName,DisplayName,AttributeType,RequiredLevel,IsPrimaryId,IsPrimaryName'

export const dataverseGetEntityMetadataTool: ToolConfig<
  DataverseGetEntityMetadataParams,
  DataverseGetEntityMetadataResponse
> = {
  id: 'microsoft_dataverse_get_entity_metadata',
  name: 'Get Microsoft Dataverse Table Metadata',
  description:
    'Retrieve table (entity) and column (attribute) definitions for a Microsoft Dataverse table by its singular logical name. Use this to look up the correct entity set name and column logical names before building record data for other operations.',
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
    entityLogicalName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Singular table logical name to look up (e.g., account, contact)',
    },
    select: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated table metadata properties to return (OData $select, e.g., LogicalName,DisplayName,EntitySetName,PrimaryIdAttribute)',
    },
    includeAttributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to "true" to also return the column (attribute) definitions for the table',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDataverseBaseUrl(params.environmentUrl)
      const entityLogicalName = params.entityLogicalName.trim()
      const queryParts: string[] = []
      if (params.select) queryParts.push(`$select=${encodeURIComponent(params.select)}`)
      if (params.includeAttributes === 'true') {
        queryParts.push(
          `$expand=${encodeURIComponent(`Attributes($select=${DEFAULT_ATTRIBUTE_SELECT})`)}`
        )
      }
      const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
      return `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${entityLogicalName}')${query}`
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
      logger.error('Dataverse get entity metadata failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json().catch(() => ({}))
    const displayName = data?.DisplayName?.UserLocalizedLabel?.Label ?? null

    return {
      success: true,
      output: {
        entitySetName: data?.EntitySetName ?? null,
        logicalName: data?.LogicalName ?? null,
        displayName,
        primaryIdAttribute: data?.PrimaryIdAttribute ?? null,
        primaryNameAttribute: data?.PrimaryNameAttribute ?? null,
        attributes: data?.Attributes ?? [],
        metadata: data ?? {},
        success: true,
      },
    }
  },

  outputs: {
    entitySetName: {
      type: 'string',
      description: 'The entity set name (plural, used in Web API URLs) for this table',
      optional: true,
    },
    logicalName: {
      type: 'string',
      description: 'The singular logical name of the table',
      optional: true,
    },
    displayName: {
      type: 'string',
      description: 'The localized display name of the table',
      optional: true,
    },
    primaryIdAttribute: {
      type: 'string',
      description: 'The logical name of the primary key column',
      optional: true,
    },
    primaryNameAttribute: {
      type: 'string',
      description: 'The logical name of the primary name (title) column',
      optional: true,
    },
    attributes: {
      type: 'array',
      description:
        'Column (attribute) definitions for the table (only populated when includeAttributes is "true")',
      items: {
        type: 'object',
        description:
          'A single column definition (logical name, display name, type, requirement level)',
      },
    },
    metadata: {
      type: 'object',
      description: 'The full raw entity metadata response from Dataverse',
    },
    success: { type: 'boolean', description: 'Whether the metadata was retrieved successfully' },
  },
}
