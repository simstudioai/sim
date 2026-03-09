import type {
  GoogleForm,
  GoogleFormsBatchUpdateParams,
  GoogleFormsBatchUpdateResponse,
} from '@/tools/google_forms/types'
import { buildBatchUpdateUrl } from '@/tools/google_forms/utils'
import type { ToolConfig } from '@/tools/types'

interface BatchUpdateApiResponse {
  replies?: Record<string, unknown>[]
  writeControl?: {
    requiredRevisionId?: string
    targetRevisionId?: string
  }
  form?: GoogleForm
}

export const batchUpdateTool: ToolConfig<
  GoogleFormsBatchUpdateParams,
  GoogleFormsBatchUpdateResponse
> = {
  id: 'google_forms_batch_update',
  name: 'Google Forms: Batch Update',
  description: 'Apply multiple updates to a form (add items, update info, change settings, etc.)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-forms',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Forms form ID',
    },
    requests: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of update requests (updateFormInfo, updateSettings, createItem, updateItem, moveItem, deleteItem)',
    },
    includeFormInResponse: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to return the updated form in the response',
    },
  },

  request: {
    url: (params: GoogleFormsBatchUpdateParams) => buildBatchUpdateUrl(params.formId),
    method: 'POST',
    headers: (params: GoogleFormsBatchUpdateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleFormsBatchUpdateParams) => ({
      requests: params.requests,
      includeFormInResponse: params.includeFormInResponse ?? false,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as BatchUpdateApiResponse

    if (!response.ok) {
      const errorData = data as unknown as { error?: { message?: string } }
      return {
        success: false,
        output: {
          replies: [],
          writeControl: null,
          form: null,
        },
        error: errorData.error?.message ?? 'Failed to batch update form',
      }
    }

    return {
      success: true,
      output: {
        replies: data.replies ?? [],
        writeControl: data.writeControl ?? null,
        form: data.form ?? null,
      },
    }
  },

  outputs: {
    replies: {
      type: 'array',
      description: 'The replies from each update request',
      items: {
        type: 'json',
      },
    },
    writeControl: {
      type: 'object',
      description: 'Write control information with revision IDs',
      optional: true,
      properties: {
        requiredRevisionId: {
          type: 'string',
          description: 'Required revision ID for conflict detection',
        },
        targetRevisionId: { type: 'string', description: 'Target revision ID' },
      },
    },
    form: {
      type: 'object',
      description: 'The updated form (if includeFormInResponse was true)',
      optional: true,
      properties: {
        formId: { type: 'string', description: 'The form ID' },
        info: {
          type: 'object',
          description: 'Form info containing title and description',
          properties: {
            title: { type: 'string', description: 'The form title visible to responders' },
            description: { type: 'string', description: 'The form description' },
            documentTitle: { type: 'string', description: 'The document title visible in Drive' },
          },
        },
        settings: {
          type: 'object',
          description: 'Form settings',
          properties: {
            quizSettings: {
              type: 'object',
              description: 'Quiz settings',
              properties: {
                isQuiz: { type: 'boolean', description: 'Whether the form is a quiz' },
              },
            },
            emailCollectionType: { type: 'string', description: 'Email collection type' },
          },
        },
        items: {
          type: 'array',
          description: 'The form items (questions, sections, etc.)',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string', description: 'Item ID' },
              title: { type: 'string', description: 'Item title' },
              description: { type: 'string', description: 'Item description' },
              questionItem: { type: 'json', description: 'Question item configuration' },
              questionGroupItem: { type: 'json', description: 'Question group configuration' },
              pageBreakItem: { type: 'json', description: 'Page break configuration' },
              textItem: { type: 'json', description: 'Text item configuration' },
              imageItem: { type: 'json', description: 'Image item configuration' },
              videoItem: { type: 'json', description: 'Video item configuration' },
            },
          },
        },
        revisionId: { type: 'string', description: 'The revision ID of the form' },
        responderUri: { type: 'string', description: 'The URI to share with responders' },
        linkedSheetId: { type: 'string', description: 'The ID of the linked Google Sheet' },
        publishSettings: {
          type: 'object',
          description: 'Form publish settings',
          properties: {
            publishState: {
              type: 'object',
              description: 'Current publish state',
              properties: {
                isPublished: { type: 'boolean', description: 'Whether the form is published' },
                isAcceptingResponses: {
                  type: 'boolean',
                  description: 'Whether the form is accepting responses',
                },
              },
            },
          },
        },
      },
    },
  },
}
