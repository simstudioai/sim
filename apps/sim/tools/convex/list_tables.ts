import type { ConvexListTablesParams, ConvexListTablesResponse } from '@/tools/convex/types'
import { convexApiUrl, convexAuthHeaders, parseConvexResponse } from '@/tools/convex/utils'
import type { ToolConfig } from '@/tools/types'

export const listTablesTool: ToolConfig<ConvexListTablesParams, ConvexListTablesResponse> = {
  id: 'convex_list_tables',
  name: 'Convex List Tables',
  description:
    'List all tables in a Convex deployment along with their JSON schemas. Requires streaming export, available on Convex paid plans.',
  version: '1.0.0',

  params: {
    deploymentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Convex deployment URL (e.g., https://your-deployment.convex.cloud)',
    },
    deployKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Convex deploy key from the dashboard Settings page',
    },
  },

  request: {
    url: (params) => convexApiUrl(params.deploymentUrl, '/api/json_schemas?format=json'),
    method: 'GET',
    headers: (params) => convexAuthHeaders(params.deployKey),
  },

  transformResponse: async (response: Response) => {
    const data = await parseConvexResponse(response)
    const schemas =
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {}

    return {
      success: true,
      output: {
        tables: Object.keys(schemas).sort(),
        schemas,
      },
    }
  },

  outputs: {
    tables: {
      type: 'array',
      description: 'Names of the tables in the deployment',
      items: { type: 'string' },
    },
    schemas: {
      type: 'json',
      description: 'Map of table name to the JSON schema of its documents',
    },
  },
}
