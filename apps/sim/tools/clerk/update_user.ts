import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkEmailAddress,
  ClerkPhoneNumber,
  ClerkUpdateUserParams,
  ClerkUpdateUserResponse,
  ClerkUser,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkUpdateUser')

export const clerkUpdateUserTool: ToolConfig<ClerkUpdateUserParams, ClerkUpdateUserResponse> = {
  id: 'clerk_update_user',
  name: 'Update User in Clerk',
  description: 'Update an existing user in your Clerk application',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user to update (e.g., user_2NNEqL2nrIRdJ194ndJqAHwEfxC)',
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
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Username (must be unique)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New password (minimum 8 characters)',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External system identifier',
    },
    primaryEmailAddressId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of verified email to set as primary',
    },
    primaryPhoneNumberId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of verified phone to set as primary',
    },
    publicMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public metadata (JSON object)',
    },
    privateMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Private metadata (JSON object)',
    },
    unsafeMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unsafe metadata (JSON object)',
    },
    skipPasswordChecks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip password validation checks',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/users/${params.userId?.trim()}`,
    method: 'PATCH',
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

      if (params.firstName !== undefined) body.first_name = params.firstName?.trim()
      if (params.lastName !== undefined) body.last_name = params.lastName?.trim()
      if (params.username !== undefined) body.username = params.username?.trim()
      if (params.password !== undefined) body.password = params.password
      if (params.externalId !== undefined) body.external_id = params.externalId?.trim()
      if (params.primaryEmailAddressId !== undefined)
        body.primary_email_address_id = params.primaryEmailAddressId?.trim()
      if (params.primaryPhoneNumberId !== undefined)
        body.primary_phone_number_id = params.primaryPhoneNumberId?.trim()
      if (params.publicMetadata !== undefined) body.public_metadata = params.publicMetadata
      if (params.privateMetadata !== undefined) body.private_metadata = params.privateMetadata
      if (params.unsafeMetadata !== undefined) body.unsafe_metadata = params.unsafeMetadata
      if (params.skipPasswordChecks !== undefined)
        body.skip_password_checks = params.skipPasswordChecks

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkUser | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to update user in Clerk'
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
        banned: user.banned ?? false,
        locked: user.locked ?? false,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        publicMetadata: user.public_metadata ?? {},
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Updated user ID' },
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
    banned: { type: 'boolean', description: 'Whether user is banned' },
    locked: { type: 'boolean', description: 'Whether user is locked' },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    publicMetadata: { type: 'json', description: 'Public metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
