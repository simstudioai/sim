import type { AgiloftListTablesParams, AgiloftListTablesResponse } from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftListTablesTool: ToolConfig<AgiloftListTablesParams, AgiloftListTablesResponse> =
  {
    id: 'agiloft_list_tables',
    name: 'Agiloft List Tables',
    description:
      'List the tables and fields in an Agiloft knowledge base, to discover the logical names other operations need.',
    version: '1.0.0',

    params: {
      instanceUrl: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Agiloft instance URL (e.g., https://mycompany.agiloft.com)',
      },
      knowledgeBase: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Knowledge base name',
      },
      login: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Agiloft username',
      },
      password: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Agiloft password',
      },
      table: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Logical name of a single table to describe (e.g., "contacts"). Leave empty to list every table in the knowledge base.',
      },
      includeLinkedInfo: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include the source table and column behind each linked field',
      },
      skipColumnsInfo: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Return table names only, omitting field details, for a much smaller response',
      },
    },

    request: {
      url: () => '/api/tools/agiloft/list_tables',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        instanceUrl: params.instanceUrl,
        knowledgeBase: params.knowledgeBase,
        login: params.login,
        password: params.password,
        table: params.table,
        includeLinkedInfo: params.includeLinkedInfo,
        skipColumnsInfo: params.skipColumnsInfo,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return {
        success: data.success ?? true,
        output: data.output,
        ...(data.error ? { error: data.error } : {}),
      }
    },

    outputs: {
      tables: {
        type: 'array',
        description: 'Tables in the knowledge base with their fields',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Display name of the table' },
            logicalName: {
              type: 'string',
              description: 'Logical table name, as other Agiloft operations expect it',
            },
            fields: {
              type: 'array',
              description: 'Fields on the table',
              items: {
                type: 'object',
                properties: {
                  columnName: { type: 'string', description: 'Logical field name' },
                  columnLabel: { type: 'string', description: 'Display label' },
                  columnType: { type: 'string', description: 'SQL column type' },
                  columnTypeDomain: { type: 'string', description: 'Agiloft field type' },
                  required: { type: 'boolean', description: 'Whether the field is mandatory' },
                  isLinked: { type: 'boolean', description: 'Whether the field is a linked field' },
                  linkedInfo: {
                    type: 'array',
                    description:
                      'Source table and column, when linked-field details were requested',
                    items: {
                      type: 'object',
                      properties: {
                        linkedTable: { type: 'string', description: 'Source table' },
                        linkedColumn: { type: 'string', description: 'Source column' },
                      },
                    },
                  },
                  textFieldType: {
                    type: 'string',
                    description: 'Content type for text fields, e.g. text/plain',
                    optional: true,
                  },
                },
              },
            },
          },
        },
      },
      totalCount: { type: 'number', description: 'Number of tables returned' },
    },
  }
