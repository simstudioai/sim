import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkEmailAddress,
  ClerkGetUserParams,
  ClerkGetUserResponse,
  ClerkPhoneNumber,
  ClerkUser,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkGetUser')

export const clerkGetUserTool: ToolConfig<ClerkGetUserParams, ClerkGetUserResponse> = {
  id: 'clerk_get_user',
  name: 'Get User from Clerk',
  description: 'Retrieve a single user by their ID from Clerk',
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
      description: 'The ID of the user to retrieve (e.g., user_2NNEqL2nrIRdJ194ndJqAHwEfxC)',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/users/${params.userId?.trim()}`,
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
    const data: ClerkUser | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to get user from Clerk'
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
        hasImage: user.has_image ?? false,
        primaryEmailAddressId: user.primary_email_address_id ?? null,
        primaryPhoneNumberId: user.primary_phone_number_id ?? null,
        primaryWeb3WalletId: user.primary_web3_wallet_id ?? null,
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
        passwordEnabled: user.password_enabled ?? false,
        twoFactorEnabled: user.two_factor_enabled ?? false,
        totpEnabled: user.totp_enabled ?? false,
        backupCodeEnabled: user.backup_code_enabled ?? false,
        banned: user.banned ?? false,
        locked: user.locked ?? false,
        deleteSelfEnabled: user.delete_self_enabled ?? false,
        createOrganizationEnabled: user.create_organization_enabled ?? false,
        lastSignInAt: user.last_sign_in_at ?? null,
        lastActiveAt: user.last_active_at ?? null,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        publicMetadata: user.public_metadata ?? {},
        privateMetadata: user.private_metadata ?? {},
        unsafeMetadata: user.unsafe_metadata ?? {},
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'User ID' },
    username: { type: 'string', description: 'Username', optional: true },
    firstName: { type: 'string', description: 'First name', optional: true },
    lastName: { type: 'string', description: 'Last name', optional: true },
    imageUrl: { type: 'string', description: 'Profile image URL', optional: true },
    hasImage: { type: 'boolean', description: 'Whether user has a profile image' },
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
    primaryWeb3WalletId: { type: 'string', description: 'Primary Web3 wallet ID', optional: true },
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
    passwordEnabled: { type: 'boolean', description: 'Whether password is enabled' },
    twoFactorEnabled: { type: 'boolean', description: 'Whether 2FA is enabled' },
    totpEnabled: { type: 'boolean', description: 'Whether TOTP is enabled' },
    backupCodeEnabled: { type: 'boolean', description: 'Whether backup codes are enabled' },
    banned: { type: 'boolean', description: 'Whether user is banned' },
    locked: { type: 'boolean', description: 'Whether user is locked' },
    deleteSelfEnabled: { type: 'boolean', description: 'Whether user can delete themselves' },
    createOrganizationEnabled: {
      type: 'boolean',
      description: 'Whether user can create organizations',
    },
    lastSignInAt: { type: 'number', description: 'Last sign-in timestamp', optional: true },
    lastActiveAt: { type: 'number', description: 'Last activity timestamp', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    publicMetadata: { type: 'json', description: 'Public metadata (readable from frontend)' },
    privateMetadata: { type: 'json', description: 'Private metadata (backend only)' },
    unsafeMetadata: { type: 'json', description: 'Unsafe metadata (modifiable from frontend)' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
