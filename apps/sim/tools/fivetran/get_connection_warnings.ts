import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  FivetranConnectionParams,
  FivetranGetConnectionWarningsResponse,
} from '@/tools/fivetran/types'
import {
  envelopePage,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_CONNECTION_ID_PARAM,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranGetConnectionWarningsTool: ToolConfig<
  FivetranConnectionParams,
  FivetranGetConnectionWarningsResponse
> = {
  id: 'fivetran_get_connection_warnings',
  name: 'Fivetran Get Connection Warnings',
  description: 'List the active warnings on a Fivetran connection, grouped by destination table.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/warnings`),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const { items } = envelopePage(await response.json())
    return {
      success: true,
      output: {
        warningGroups: items.map((value) => {
          const group = toRecord(value)
          return {
            schema: toStringOrNull(group.schema),
            table: toStringOrNull(group.table),
            warnings: toArray(group.warnings).map((entry) => {
              const warning = toRecord(entry)
              return {
                code: toStringOrNull(warning.code),
                message: toStringOrNull(warning.message),
                errorMessage: toStringOrNull(warning.error_message),
                createdAt: toStringOrNull(warning.created_at),
              }
            }),
          }
        }),
      },
    }
  },

  outputs: {
    warningGroups: {
      type: 'array',
      description: 'Warnings grouped by destination table',
      items: {
        type: 'object',
        properties: {
          schema: {
            type: 'string',
            description: 'Destination schema; null when the warning is not table-specific',
            nullable: true,
          },
          table: {
            type: 'string',
            description: 'Destination table; null when the warning is not table-specific',
            nullable: true,
          },
          warnings: {
            type: 'array',
            description: 'Warnings on the table',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Warning code', nullable: true },
                message: { type: 'string', description: 'Warning label', nullable: true },
                errorMessage: {
                  type: 'string',
                  description: 'Additional error details',
                  nullable: true,
                },
                createdAt: {
                  type: 'string',
                  description: 'When the warning was raised',
                  nullable: true,
                },
              },
            },
          },
        },
      },
    },
  },
}
