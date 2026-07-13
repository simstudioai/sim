import {
  BUFFER_API_URL,
  type BufferCreateIdeaParams,
  type BufferIdea,
  type BufferIdeaResponse,
  bufferHeaders,
  IDEA_OUTPUT_PROPERTIES,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const IDEA_SELECTION = `
  id
  organizationId
  groupId
  content {
    title
    text
  }
`

const CREATE_IDEA_MUTATION = `
  mutation CreateIdea($input: CreateIdeaInput!) {
    createIdea(input: $input) {
      __typename
      ... on Idea {
        ${IDEA_SELECTION}
      }
      ... on IdeaResponse {
        idea {
          ${IDEA_SELECTION}
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`

/**
 * Maps a raw GraphQL Idea node onto the stable output shape.
 */
function mapIdea(idea: Record<string, any>): BufferIdea {
  return {
    id: idea.id,
    organizationId: idea.organizationId ?? '',
    groupId: idea.groupId ?? null,
    title: idea.content?.title ?? null,
    text: idea.content?.text ?? null,
  }
}

export const bufferCreateIdeaTool: ToolConfig<BufferCreateIdeaParams, BufferIdeaResponse> = {
  id: 'buffer_create_idea',
  name: 'Buffer Create Idea',
  description: 'Save a content idea to a Buffer organization for later drafting and scheduling',
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
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text content of the idea',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional title for the idea',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional idea group (board column) to place the idea in',
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => {
      const content: Record<string, unknown> = { text: params.text }
      if (params.title) content.title = params.title

      const input: Record<string, unknown> = {
        organizationId: params.organizationId,
        content,
      }
      if (params.groupId) input.group = { groupId: params.groupId }

      return {
        query: CREATE_IDEA_MUTATION,
        variables: { input },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    const result = data.createIdea
    const idea = result?.__typename === 'Idea' ? result : result?.idea
    if (!idea?.id) {
      throw new Error(result?.message || 'Failed to create idea')
    }
    return {
      success: true,
      output: {
        idea: mapIdea(idea),
      },
    }
  },

  outputs: {
    idea: {
      type: 'object',
      description: 'The created idea',
      properties: IDEA_OUTPUT_PROPERTIES,
    },
  },
}
