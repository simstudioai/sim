import { toRecord } from '@sim/utils/object'
import { bufferInputDescription, parseBufferInput } from '@/tools/buffer/schema'
import {
  BUFFER_API_URL,
  BUFFER_IDEA_SELECTION,
  type BufferCreateIdeaParams,
  type BufferIdeaResponse,
  bufferHeaders,
  IDEA_OUTPUT_PROPERTIES,
  mapBufferIdea,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const CREATE_IDEA_MUTATION = `
  mutation CreateIdea($input: CreateIdeaInput!) {
    createIdea(input: $input) {
      __typename
      ... on Idea {
        ${BUFFER_IDEA_SELECTION}
      }
      ... on IdeaResponse {
        idea {
          ${BUFFER_IDEA_SELECTION}
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`

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
      required: false,
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
    content: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: bufferInputDescription(
        'IdeaContentInput',
        'Idea title, text, and media content.'
      ),
    },
    group: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: bufferInputDescription(
        'IdeaGroupInput',
        'Assign the idea to a group and optionally position it after another idea.'
      ),
    },
    cta: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Call to action tracking value',
    },
    templateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Template ID used to create the idea',
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => {
      const content = params.content ? parseBufferInput('IdeaContentInput', params.content) : {}
      if (params.text !== undefined) content.text = params.text
      if (params.title !== undefined) content.title = params.title
      const input = parseBufferInput('CreateIdeaInput', {
        organizationId: params.organizationId,
        content,
        ...(params.group
          ? { group: params.group }
          : params.groupId
            ? { group: { groupId: params.groupId } }
            : {}),
        ...(params.cta !== undefined ? { cta: params.cta } : {}),
        ...(params.templateId !== undefined ? { templateId: params.templateId } : {}),
      })

      return {
        query: CREATE_IDEA_MUTATION,
        variables: { input },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    const result = toRecord(data.createIdea)
    const idea = result.__typename === 'Idea' ? result : toRecord(result.idea)
    if (!idea?.id) {
      throw new Error(typeof result.message === 'string' ? result.message : 'Failed to create idea')
    }
    return {
      success: true,
      output: {
        idea: mapBufferIdea(idea),
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
