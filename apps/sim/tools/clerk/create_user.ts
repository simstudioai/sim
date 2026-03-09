import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkCreateUserParams,
  ClerkCreateUserResponse,
  ClerkEmailAddress,
  ClerkPhoneNumber,
  ClerkUser,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkCreateUser')

export const clerkCreateUserTool: ToolConfig<ClerkCreateUserParams, ClerkCreateUserResponse> = {
  id: 'clerk_create_user',
  name: 'Create User in Clerk',
  description: 'Create a new user in your Clerk application',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    emailAddress: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email addresses for the user (comma-separated for multiple)',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone numbers for the user (comma-separated for multiple)',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Username for the user (must be unique)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Password for the user (minimum 8 characters)',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the user',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the user',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External system identifier (must be unique)',
    },
    publicMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public metadata (JSON object, readable from frontend)',
    },
    privateMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Private metadata (JSON object, backend only)',
    },
    unsafeMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unsafe metadata (JSON object, modifiable from frontend)',
    },
    skipPasswordChecks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip password validation checks',
    },
    skipPasswordRequirement: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Make password optional',
    },
  },

  request: {
    url: () => 'https://api.clerk.com/v1/users',
    method: 'POST',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.emailAddress) {
        const emailStr = params.emailAddress as string
        body.email_address = emailStr.split(',').map((e) => e.trim())
      }
      if (params.phoneNumber) {
        const phoneStr = params.phoneNumber as string
        body.phone_number = phoneStr.split(',').map((p) => p.trim())
      }
      if (params.username) body.username = params.username.trim()
      if (params.password) body.password = params.password
      if (params.firstName) body.first_name = params.firstName.trim()
      if (params.lastName) body.last_name = params.lastName.trim()
      if (params.externalId) body.external_id = params.externalId.trim()
      if (params.publicMetadata) body.public_metadata = params.publicMetadata
      if (params.privateMetadata) body.private_metadata = params.privateMetadata
      if (params.unsafeMetadata) body.unsafe_metadata = params.unsafeMetadata
      if (params.skipPasswordChecks !== undefined)
        body.skip_password_checks = params.skipPasswordChecks
      if (params.skipPasswordRequirement !== undefined)
        body.skip_password_requirement = params.skipPasswordRequirement

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkUser | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to create user in Clerk'
      )
    }

    const user = data as ClerkUser
    return {
      success: true,
      output: {
        id: user.id,
        username: user.username ?? null,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
        imageUrl: user.image_url ?? null,
        primaryEmailAddressId: user.primary_email_address_id ?? null,
        primaryPhoneNumberId: user.primary_phone_number_id ?? null,
        emailAddresses: (user.email_addresses ?? []).map((email: ClerkEmailAddress) => ({
          id: email.id,
          emailAddress: email.email_address,
          verified: email.verification?.status === 'verified',
        })),
        phoneNumbers: (user.phone_numbers ?? []).map((phone: ClerkPhoneNumber) => ({
          id: phone.id,
          phoneNumber: phone.phone_number,
          verified: phone.verification?.status === 'verified',
        })),
        externalId: user.external_id ?? null,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        publicMetadata: user.public_metadata ?? {},
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created user ID' },
    username: { type: 'string', description: 'Username', optional: true },
    firstName: { type: 'string', description: 'First name', optional: true },
    lastName: { type: 'string', description: 'Last name', optional: true },
    imageUrl: { type: 'string', description: 'Profile image URL', optional: true },
    primaryEmailAddressId: {
      type: 'string',
      description: 'Primary email address ID',
      optional: true,
    },
    primaryPhoneNumberId: {
      type: 'string',
      description: 'Primary phone number ID',
      optional: true,
    },
    emailAddresses: {
      type: 'array',
      description: 'User email addresses',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Email address ID' },
          emailAddress: { type: 'string', description: 'Email address' },
          verified: { type: 'boolean', description: 'Whether email is verified' },
        },
      },
    },
    phoneNumbers: {
      type: 'array',
      description: 'User phone numbers',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Phone number ID' },
          phoneNumber: { type: 'string', description: 'Phone number' },
          verified: { type: 'boolean', description: 'Whether phone is verified' },
        },
      },
    },
    externalId: { type: 'string', description: 'External system ID', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    publicMetadata: { type: 'json', description: 'Public metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
