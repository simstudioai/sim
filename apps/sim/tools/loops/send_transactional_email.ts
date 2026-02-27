import type {
  LoopsSendTransactionalEmailParams,
  LoopsSendTransactionalEmailResponse,
} from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsSendTransactionalEmailTool: ToolConfig<
  LoopsSendTransactionalEmailParams,
  LoopsSendTransactionalEmailResponse
> = {
  id: 'loops_send_transactional_email',
  name: 'Loops Send Transactional Email',
  description:
    'Send a transactional email to a recipient using a Loops template. Supports dynamic data variables for personalization and optionally adds the recipient to your audience.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The email address of the recipient',
    },
    transactionalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the transactional email template to send',
    },
    dataVariables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Template data variables as key-value pairs (string or number values)',
    },
    addToAudience: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to create the recipient as a contact if they do not already exist (default: false)',
    },
    attachments: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of file attachments. Each object must have filename (string), contentType (MIME type string), and data (base64-encoded string).',
    },
  },

  request: {
    url: 'https://app.loops.so/api/v1/transactional',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        email: params.email,
        transactionalId: params.transactionalId,
      }

      if (params.dataVariables) {
        body.dataVariables =
          typeof params.dataVariables === 'string'
            ? JSON.parse(params.dataVariables)
            : params.dataVariables
      }

      if (params.addToAudience != null) {
        body.addToAudience = params.addToAudience
      }

      if (params.attachments) {
        body.attachments =
          typeof params.attachments === 'string'
            ? JSON.parse(params.attachments)
            : params.attachments
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          success: false,
        },
        error: data.message ?? 'Failed to send transactional email',
      }
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the transactional email was sent successfully',
    },
  },
}
