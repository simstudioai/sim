import type { TypeformUpdateFormParams, TypeformUpdateFormResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

export const updateFormTool: ToolConfig<TypeformUpdateFormParams, TypeformUpdateFormResponse> = {
  id: 'typeform_update_form',
  name: 'Typeform Update Form',
  description: 'Update an existing form using JSON Patch operations',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform Personal Access Token',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Form unique identifier to update (e.g., "abc123XYZ")',
    },
    operations: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description:
        'Array of JSON Patch operations (RFC 6902). Each operation needs: op (add/remove/replace), path, and value (for add/replace)',
    },
  },

  request: {
    url: (params: TypeformUpdateFormParams) => {
      return `https://api.typeform.com/forms/${params.formId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: TypeformUpdateFormParams) => {
      return params.operations
    },
  },

  transformResponse: async (response: Response) => {
    // Check if response has content
    const text = await response.text()

    // Handle empty responses
    if (!text || text.trim() === '') {
      if (response.ok) {
        // Success with no content (e.g., 204 No Content)
        return {
          success: true,
          output: {
            message: 'Form updated successfully',
          },
        }
      }
      throw new Error(`Request failed with status ${response.status}: ${response.statusText}`)
    }

    // Try to parse as JSON
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      // If response is not OK and not JSON, throw with the raw text
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}: ${text.slice(0, 200)}`)
      }
      throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`)
    }

    // Handle error responses from Typeform API
    if (!response.ok) {
      const errorMessage = data.description || data.message || data.error || JSON.stringify(data)
      throw new Error(`Typeform API error (${response.status}): ${errorMessage}`)
    }

    // Return simple success message (Typeform PATCH returns minimal/no content on success)
    return {
      success: true,
      output: {
        message: 'Form updated successfully',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Success confirmation message',
    },
  },
}
