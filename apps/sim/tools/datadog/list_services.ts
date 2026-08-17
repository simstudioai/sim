import type {
  DatadogV2Resource,
  ListServicesParams,
  ListServicesResponse,
  ServiceDefinitionAttributes,
} from '@/tools/datadog/types'
import { datadogApiUrl, datadogErrorMessage, datadogHeaders } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const listServicesTool: ToolConfig<ListServicesParams, ListServicesResponse> = {
  id: 'datadog_list_services',
  name: 'Datadog List Services',
  description:
    'List service definitions from the Datadog Service Catalog. Requires the `apm_service_catalog_read` permission.',
  version: '1.0.0',

  params: {
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of service definitions per page (default: 10, max: 100)',
    },
    pageNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page to retrieve, starting at zero',
    },
    schemaVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema version to return (e.g., "v2", "v2.1", "v2.2")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.pageSize !== undefined) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber !== undefined)
        queryParams.set('page[number]', String(params.pageNumber))
      if (params.schemaVersion) queryParams.set('schema_version', params.schemaVersion)
      const queryString = queryParams.toString()
      return datadogApiUrl(
        params.site,
        `/api/v2/services/definitions${queryString ? `?${queryString}` : ''}`
      )
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { services: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        services: (data.data ?? []).map(
          (service: DatadogV2Resource<ServiceDefinitionAttributes>) => ({
            id: service.id,
            type: service.type,
            schema: service.attributes?.schema ?? {},
            meta: service.attributes?.meta ?? {},
          })
        ),
      },
    }
  },

  outputs: {
    services: {
      type: 'array',
      description: 'List of service definitions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Service definition ID' },
          type: { type: 'string', description: 'Resource type (service_definitions)' },
          schema: {
            type: 'object',
            description:
              'The service definition schema. Its shape depends on the requested schema version',
          },
          meta: {
            type: 'object',
            description: 'Ingestion metadata such as origin and last modified time',
          },
        },
      },
    },
  },
}
