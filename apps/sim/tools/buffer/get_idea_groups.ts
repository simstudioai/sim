import {
  BUFFER_API_URL,
  type BufferGetIdeaGroupsParams,
  type BufferIdeaGroupsResponse,
  bufferHeaders,
  IDEA_GROUP_OUTPUT_PROPERTIES,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const GET_IDEA_GROUPS_QUERY = `
  query GetIdeaGroups($input: IdeaGroupsInput!) {
    ideaGroups(input: $input) {
      id
      name
      isLocked
    }
  }
`

export const bufferGetIdeaGroupsTool: ToolConfig<
  BufferGetIdeaGroupsParams,
  BufferIdeaGroupsResponse
> = {
  id: 'buffer_get_idea_groups',
  name: 'Buffer Get Idea Groups',
  description:
    'List idea groups (board columns) in a Buffer organization, including the group IDs used when creating ideas',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key',
    },
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Buffer organization ID (find it with the Get Account operation)',
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: GET_IDEA_GROUPS_QUERY,
      variables: {
        input: { organizationId: params.organizationId },
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    return {
      success: true,
      output: {
        ideaGroups: (data.ideaGroups ?? []).map((group: Record<string, any>) => ({
          id: group.id,
          name: group.name ?? '',
          isLocked: group.isLocked ?? false,
        })),
      },
    }
  },

  outputs: {
    ideaGroups: {
      type: 'array',
      description: 'Idea groups (board columns) in the organization',
      items: { type: 'object', properties: IDEA_GROUP_OUTPUT_PROPERTIES },
    },
  },
}
