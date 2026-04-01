import type { KetchInvokeRightParams, KetchInvokeRightResponse } from '@/tools/ketch/types'
import type { ToolConfig } from '@/tools/types'

export const invokeRightTool: ToolConfig<KetchInvokeRightParams, KetchInvokeRightResponse> = {
  id: 'ketch_invoke_right',
  name: 'Ketch Invoke Right',
  description:
    'Submit a data subject rights request (e.g., access, delete, correct, restrict processing). Initiates a privacy rights workflow in Ketch.',
  version: '1.0.0',

  params: {
    organizationCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ketch organization code',
    },
    propertyCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Digital property code defined in Ketch',
    },
    environmentCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Environment code defined in Ketch (e.g., "production")',
    },
    jurisdictionCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jurisdiction code (e.g., "gdpr", "ccpa")',
    },
    rightCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Privacy right code to invoke (e.g., "access", "delete", "correct", "restrict_processing")',
    },
    identities: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity map (e.g., {"email": "user@example.com"})',
    },
    userData: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional data subject information (e.g., {"email": "user@example.com", "firstName": "John", "lastName": "Doe"})',
    },
  },

  request: {
    url: (params) =>
      `https://global.ketchcdn.com/web/v2/rights/${encodeURIComponent(params.organizationCode.trim())}/invoke`,
    method: 'POST',
    headers: () => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        organizationCode: params.organizationCode.trim(),
        propertyCode: params.propertyCode,
        environmentCode: params.environmentCode,
        jurisdictionCode: params.jurisdictionCode,
        rightCode: params.rightCode,
        identities: params.identities,
      }
      if (params.userData) body.user = params.userData
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`
      try {
        const data = await response.json()
        errorMessage = data.message ?? data.error ?? errorMessage
      } catch {
        // No JSON body in error response
      }
      return {
        success: false,
        output: {
          success: false,
          message: errorMessage,
        },
      }
    }

    let message: string | null = null
    try {
      const data = await response.json()
      message = data.message ?? null
    } catch {
      // 204 No Content - no body to parse
    }

    return {
      success: true,
      output: {
        success: true,
        message,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the rights request was submitted' },
    message: {
      type: 'string',
      description: 'Response message from Ketch',
      optional: true,
    },
  },
}
