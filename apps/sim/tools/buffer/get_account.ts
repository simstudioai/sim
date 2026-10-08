import { bufferInputDescription, bufferSelection, parseBufferInput } from '@/tools/buffer/schema'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  BUFFER_API_URL,
  type BufferAccountResponse,
  type BufferGetAccountParams,
  bufferHeaders,
  mapBufferAccount,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const GET_ACCOUNT_QUERY = `query GetAccount($organizationFilter: OrganizationFilterInput) {
  account { ${bufferSelection('Account').replace('organizations {', 'organizations(filter: $organizationFilter) {')} }
}`

export const bufferGetAccountTool: ToolConfig<BufferGetAccountParams, BufferAccountResponse> = {
  id: 'buffer_get_account',
  name: 'Buffer Get Account',
  description:
    'Get the authenticated Buffer account, including its organizations and their IDs (needed for channel and post operations)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key',
    },
    organizationFilter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: bufferInputDescription('OrganizationFilterInput'),
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: GET_ACCOUNT_QUERY,
      variables: {
        organizationFilter: params.organizationFilter
          ? parseBufferInput('OrganizationFilterInput', params.organizationFilter)
          : null,
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    const account = data.account
    if (!account) {
      throw new Error('Buffer account not found — check that the API key is valid')
    }
    return {
      success: true,
      output: {
        account: mapBufferAccount(account),
      },
    }
  },

  outputs: {
    account: {
      type: 'object',
      description: 'The authenticated Buffer account',
      properties: ACCOUNT_OUTPUT_PROPERTIES,
    },
  },
}
