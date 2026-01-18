import type {
  GoogleForm,
  GoogleFormsBatchUpdateParams,
  GoogleFormsBatchUpdateResponse,
} from '@/tools/google_form/types'
import { buildBatchUpdateUrl } from '@/tools/google_form/utils'
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
      visibility: 'user-only',
      description: 'The ID of the Google Form to update',
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
      type: 'json',
      description: 'Write control information with revision IDs',
      optional: true,
    },
    form: {
      type: 'json',
      description: 'The updated form (if includeFormInResponse was true)',
      optional: true,
    },
  },
}
