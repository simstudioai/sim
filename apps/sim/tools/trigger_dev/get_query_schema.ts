import type { TriggerDevBaseParams, TriggerDevQuerySchemaResponse } from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetQuerySchemaTool: ToolConfig<
  TriggerDevBaseParams,
  TriggerDevQuerySchemaResponse
> = {
  id: 'trigger_dev_get_query_schema',
  name: 'Trigger.dev Get Query Schema',
  description:
    'Retrieve the TRQL query schema: the tables and columns available for Execute Query, with types and allowed values.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
  },

  request: {
    url: `${TRIGGER_DEV_API_BASE}/api/v1/query/schema`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        tables: (data.tables ?? []).map(
          (table: {
            name?: string
            description?: string
            timeColumn?: string
            columns?: {
              name?: string
              type?: string
              description?: string
              example?: string
              allowedValues?: string[]
              coreColumn?: boolean
            }[]
          }) => ({
            name: table.name ?? null,
            description: table.description ?? null,
            timeColumn: table.timeColumn ?? null,
            columns: (table.columns ?? []).map((column) => ({
              name: column.name ?? null,
              type: column.type ?? null,
              description: column.description ?? null,
              example: column.example ?? null,
              allowedValues: column.allowedValues ?? [],
              coreColumn: column.coreColumn ?? false,
            })),
          })
        ),
      },
    }
  },

  outputs: {
    tables: {
      type: 'array',
      description: 'Tables that can be queried with TRQL',
      items: {
        type: 'object',
        description: 'Queryable table',
        properties: {
          name: { type: 'string', description: 'Table name used in TRQL queries', nullable: true },
          description: { type: 'string', description: 'Description of the table', nullable: true },
          timeColumn: {
            type: 'string',
            description: 'Primary time column for the table',
            nullable: true,
          },
          columns: {
            type: 'array',
            description: 'Columns of the table',
            items: {
              type: 'object',
              description: 'Table column',
              properties: {
                name: { type: 'string', description: 'Column name', nullable: true },
                type: { type: 'string', description: 'ClickHouse data type', nullable: true },
                description: {
                  type: 'string',
                  description: 'Column description',
                  nullable: true,
                },
                example: { type: 'string', description: 'Example value', nullable: true },
                allowedValues: {
                  type: 'array',
                  description: 'Allowed values for enum-like columns',
                  items: { type: 'string', description: 'Allowed value' },
                },
                coreColumn: {
                  type: 'boolean',
                  description: 'Whether the column is included in default queries',
                },
              },
            },
          },
        },
      },
    },
  },
}
