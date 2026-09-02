import { buildOracleConnectionInput, ORACLE_CONNECTION_PARAMS } from '@/tools/oracledb/shared'
import {
  ORACLE_TABLE_OUTPUT_PROPERTIES,
  type OracleIntrospectParams,
  type OracleIntrospectResponse,
  type OracleTableSchema,
} from '@/tools/oracledb/types'
import type { InternalToolConfig } from '@/tools/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const oracleIntrospectTool: InternalToolConfig<
  OracleIntrospectParams,
  OracleIntrospectResponse
> = {
  id: 'oracledb_introspect',
  name: 'Oracle Database Introspect',
  description:
    'Inspect accessible Oracle tables, columns, keys, non-primary-key indexes, and table-owning schemas using ALL_* dictionary views',
  version: '1.0.0',
  params: {
    ...ORACLE_CONNECTION_PARAMS,
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional schema to inspect; omit it to inspect CURRENT_SCHEMA and list table owners visible through ALL_TABLES',
    },
  },
  operation: {
    input: (params) => ({
      ...buildOracleConnectionInput(params),
      ...(params.schema !== undefined ? { schema: params.schema } : {}),
    }),
  },
  transformResponse: async (response) => {
    const payload: unknown = await response.json()
    const data = isRecord(payload) ? payload : {}

    if (!response.ok) {
      throw new Error(
        typeof data.error === 'string' ? data.error : 'Oracle Database introspection failed'
      )
    }

    return {
      success: true,
      output: {
        message:
          typeof data.message === 'string'
            ? data.message
            : 'Schema introspection completed successfully',
        tables: Array.isArray(data.tables) ? (data.tables as OracleTableSchema[]) : [],
        schemas: Array.isArray(data.schemas)
          ? data.schemas.filter((schema): schema is string => typeof schema === 'string')
          : [],
      },
    }
  },
  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    tables: {
      type: 'array',
      description: 'Accessible table schemas with columns, keys, and indexes',
      items: { type: 'object', properties: ORACLE_TABLE_OUTPUT_PROPERTIES },
    },
    schemas: {
      type: 'array',
      description:
        'Table-owning schemas visible through ALL_TABLES, plus the selected or current schema',
      items: { type: 'string', description: 'Schema name' },
    },
  },
}
