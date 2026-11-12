import type { HexGetDataConnectionParams, HexGetDataConnectionResponse } from '@/tools/hex/types'
import { HEX_HOST_PARAM, hexApiBase } from '@/tools/hex/utils'
import { HEX_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const getDataConnectionTool: ToolConfig<
  HexGetDataConnectionParams,
  HexGetDataConnectionResponse
> = {
  id: 'hex_get_data_connection',
  name: 'Hex Get Data Connection',
  description:
    'Retrieve details for a specific data connection including type, description, and configuration flags.',
  version: '1.0.0',
  oauth: HEX_CREDENTIAL_OAUTH,

  params: {
    host: HEX_HOST_PARAM,
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    dataConnectionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the data connection',
    },
  },

  request: {
    url: (params) =>
      `${hexApiBase(params.host)}/data-connections/${params.dataConnectionId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? null,
        name: data.name ?? null,
        type: data.type ?? null,
        description: data.description ?? null,
        connectViaSsh: data.connectViaSsh ?? null,
        includeMagic: data.includeMagic ?? null,
        allowWritebackCells: data.allowWritebackCells ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Connection UUID' },
    name: { type: 'string', description: 'Connection name' },
    type: { type: 'string', description: 'Connection type (e.g., snowflake, postgres, bigquery)' },
    description: { type: 'string', description: 'Connection description', optional: true },
    connectViaSsh: {
      type: 'boolean',
      description: 'Whether SSH tunneling is enabled',
      optional: true,
    },
    includeMagic: {
      type: 'boolean',
      description: 'Whether Magic AI features are enabled',
      optional: true,
    },
    allowWritebackCells: {
      type: 'boolean',
      description: 'Whether writeback cells are allowed',
      optional: true,
    },
  },
}
