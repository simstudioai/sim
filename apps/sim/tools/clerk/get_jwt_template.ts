import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkGetJwtTemplateParams,
  ClerkGetJwtTemplateResponse,
  ClerkJwtTemplate,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkGetJwtTemplate')

export const clerkGetJwtTemplateTool: ToolConfig<
  ClerkGetJwtTemplateParams,
  ClerkGetJwtTemplateResponse
> = {
  id: 'clerk_get_jwt_template',
  name: 'Get JWT Template from Clerk',
  description: 'Retrieve a single custom JWT template by ID from Clerk',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    templateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the JWT template to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/jwt_templates/${params.templateId?.trim()}`,
    method: 'GET',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkJwtTemplate | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to get JWT template from Clerk'
      )
    }

    const template = data as ClerkJwtTemplate

    return {
      success: true,
      output: {
        id: template.id,
        name: template.name,
        claims: template.claims ?? {},
        lifetime: template.lifetime,
        allowedClockSkew: template.allowed_clock_skew,
        customSigningKey: template.custom_signing_key ?? false,
        signingAlgorithm: template.signing_algorithm,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'JWT template ID' },
    name: { type: 'string', description: 'JWT template name' },
    claims: { type: 'json', description: 'Custom claims defined on the template' },
    lifetime: { type: 'number', description: 'Token lifetime in seconds' },
    allowedClockSkew: { type: 'number', description: 'Allowed clock skew in seconds' },
    customSigningKey: {
      type: 'boolean',
      description: 'Whether a custom signing key is configured',
    },
    signingAlgorithm: { type: 'string', description: 'Signing algorithm used' },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
