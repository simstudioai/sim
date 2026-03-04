import type {
  AirtableField,
  AirtableListTablesParams,
  AirtableListTablesResponse,
  AirtableTable,
} from '@/tools/airtable/types'
import type { ToolConfig } from '@/tools/types'

export const airtableListTablesTool: ToolConfig<
  AirtableListTablesParams,
  AirtableListTablesResponse
> = {
  id: 'airtable_list_tables',
  name: 'Airtable List Tables',
  description: 'List all tables and their schema in an Airtable base',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'airtable',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    baseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Airtable base ID (starts with "app", e.g., "appXXXXXXXXXXXXXX")',
    },
  },

  request: {
    url: (params) => `https://api.airtable.com/v0/meta/bases/${params.baseId?.trim()}/tables`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    const data = await response.json()
    const tables: AirtableTable[] = (data.tables ?? []).map(
      (table: {
        id: string
        name: string
        description?: string
        primaryFieldId: string
        fields: AirtableField[]
      }) => ({
        id: table.id,
        name: table.name,
        description: table.description ?? null,
        primaryFieldId: table.primaryFieldId,
        fields: (table.fields ?? []).map((field: AirtableField) => ({
          id: field.id,
          name: field.name,
          type: field.type,
          description: field.description ?? null,
          options: field.options ?? null,
        })),
      })
    )

    return {
      success: true,
      output: {
        tables,
        metadata: {
          baseId: params?.baseId ?? '',
          totalTables: tables.length,
        },
      },
    }
  },

  outputs: {
    tables: {
      type: 'array',
      description: 'List of tables in the base with their schema',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Table ID (starts with "tbl")' },
          name: { type: 'string', description: 'Table name' },
          description: { type: 'string', description: 'Table description' },
          primaryFieldId: { type: 'string', description: 'ID of the primary field' },
          fields: {
            type: 'array',
            description: 'List of fields in the table',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Field ID (starts with "fld")' },
                name: { type: 'string', description: 'Field name' },
                type: {
                  type: 'string',
                  description:
                    'Field type (singleLineText, multilineText, number, checkbox, singleSelect, multipleSelects, date, dateTime, attachment, linkedRecord, etc.)',
                },
                description: { type: 'string', description: 'Field description' },
                options: { type: 'json', description: 'Field-specific options (choices, etc.)' },
              },
            },
          },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Base info and count metadata',
      properties: {
        baseId: { type: 'string', description: 'The base ID queried' },
        totalTables: { type: 'number', description: 'Number of tables in the base' },
      },
    },
  },
}
