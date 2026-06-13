import type {
  PersonaImportAccountsParams,
  PersonaImportAccountsResponse,
} from '@/tools/persona/types'
import { IMPORTER_OUTPUT_PROPERTIES } from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaImportAccountsTool: ToolConfig<
  PersonaImportAccountsParams,
  PersonaImportAccountsResponse
> = {
  id: 'persona_import_accounts',
  name: 'Persona Import Accounts',
  description:
    'Bulk-import accounts into Persona from a CSV file. Returns an importer whose status can be polled until processing completes.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'CSV file of accounts to import',
    },
  },

  request: {
    url: '/api/tools/persona/import-accounts',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      apiKey: params.apiKey,
      file: params.file,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to import accounts into Persona')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    importer: {
      type: 'object',
      description: 'The created account importer',
      properties: IMPORTER_OUTPUT_PROPERTIES,
    },
  },
}
