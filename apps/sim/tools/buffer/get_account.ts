import {
  ACCOUNT_OUTPUT_PROPERTIES,
  BUFFER_API_URL,
  type BufferAccountResponse,
  type BufferGetAccountParams,
  bufferHeaders,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const GET_ACCOUNT_QUERY = `
  query GetAccount {
    account {
      id
      email
      name
      timezone
      organizations {
        id
        name
        channelCount
        ownerEmail
      }
    }
  }
`

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
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: () => ({ query: GET_ACCOUNT_QUERY }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    const account = data.account
    return {
      success: true,
      output: {
        account: {
          id: account.id,
          email: account.email ?? '',
          name: account.name ?? null,
          timezone: account.timezone ?? null,
          organizations: (account.organizations ?? []).map((org: Record<string, any>) => ({
            id: org.id,
            name: org.name ?? '',
            channelCount: org.channelCount ?? 0,
            ownerEmail: org.ownerEmail ?? '',
          })),
        },
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
