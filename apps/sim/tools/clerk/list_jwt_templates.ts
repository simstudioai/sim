import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkJwtTemplate,
  ClerkListJwtTemplatesParams,
  ClerkListJwtTemplatesResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkListJwtTemplates')

export const clerkListJwtTemplatesTool: ToolConfig<
  ClerkListJwtTemplatesParams,
  ClerkListJwtTemplatesResponse
> = {
  id: 'clerk_list_jwt_templates',
  name: 'List JWT Templates from Clerk',
  description: 'List custom JWT templates configured on your Clerk instance',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
  },

  request: {
    url: () => 'https://api.clerk.com/v1/jwt_templates',
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
    const data: ClerkJwtTemplate[] | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to list JWT templates from Clerk'
      )
    }

    const templates = (data as ClerkJwtTemplate[]).map((template) => ({
      id: template.id,
      name: template.name,
      claims: template.claims ?? {},
      lifetime: template.lifetime,
      allowedClockSkew: template.allowed_clock_skew,
      customSigningKey: template.custom_signing_key ?? false,
      signingAlgorithm: template.signing_algorithm,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
    }))

    return {
      success: true,
      output: {
        templates,
        totalCount: templates.length,
        success: true,
      },
    }
  },

  outputs: {
    templates: {
      type: 'array',
      description: 'Array of Clerk JWT template objects',
      items: {
        type: 'object',
        properties: {
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
        },
      },
    },
    totalCount: { type: 'number', description: 'Total number of JWT templates' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
