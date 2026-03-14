import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface AirtableGetBaseSchemaParams {
  accessToken: string
  baseId: string
}

interface AirtableFieldSchema {
  id: string
  name: string
  type: string
  description?: string
  options?: Record<string, unknown>
}

interface AirtableViewSchema {
  id: string
  name: string
  type: string
}

interface AirtableTableSchema {
  id: string
  name: string
  description?: string
  fields: AirtableFieldSchema[]
  views: AirtableViewSchema[]
}

export interface AirtableGetBaseSchemaResponse extends ToolResponse {
  output: {
    tables: AirtableTableSchema[]
    metadata: {
      totalTables: number
    }
  }
}

export const airtableGetBaseSchemaTool: ToolConfig<
  AirtableGetBaseSchemaParams,
  AirtableGetBaseSchemaResponse
> = {
  id: 'airtable_get_base_schema',
  name: 'Airtable Get Base Schema',
  description: 'Get the schema of all tables, fields, and views in an Airtable base',
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
    url: (params) => `https://api.airtable.com/v0/meta/bases/${params.baseId}/tables`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const tables = (data.tables || []).map((table: Record<string, unknown>) => ({
      id: table.id,
      name: table.name,
      description: table.description,
      fields: ((table.fields as Record<string, unknown>[]) || []).map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        description: field.description,
        options: field.options,
      })),
      views: ((table.views as Record<string, unknown>[]) || []).map((view) => ({
        id: view.id,
        name: view.name,
        type: view.type,
      })),
    }))
    return {
      success: true,
      output: {
        tables,
        metadata: {
          totalTables: tables.length,
        },
      },
    }
  },

  outputs: {
    tables: {
      type: 'json',
      description: 'Array of table schemas with fields and views',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          fields: { type: 'json' },
          views: { type: 'json' },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata including total tables count',
    },
  },
}
