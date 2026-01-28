import type { ToolResponse } from '@/tools/types'

/**
 * Clerk API error response
 */
export interface ClerkApiError {
  errors?: { message: string }[]
}

/**
 * Clerk delete response
 */
export interface ClerkDeleteResponse {
  id: string
  object: string
  deleted: boolean
}

/**
 * Clerk User object
 */
export interface ClerkUser {
  id: string
  object: 'user'
  username: string | null
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  primary_email_address_id: string | null
  primary_phone_number_id: string | null
  primary_web3_wallet_id: string | null
  password_enabled: boolean
  two_factor_enabled: boolean
  totp_enabled: boolean
  backup_code_enabled: boolean
  email_addresses: ClerkEmailAddress[]
  phone_numbers: ClerkPhoneNumber[]
  web3_wallets: ClerkWeb3Wallet[]
  external_accounts: ClerkExternalAccount[]
  external_id: string | null
  last_sign_in_at: number | null
  banned: boolean
  locked: boolean
  lockout_expires_in_seconds: number | null
  verification_attempts_remaining: number | null
  created_at: number
  updated_at: number
  delete_self_enabled: boolean
  create_organization_enabled: boolean
  last_active_at: number | null
  profile_image_url: string
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  unsafe_metadata: Record<string, unknown>
}

export interface ClerkEmailAddress {
  id: string
  object: 'email_address'
  email_address: string
  verification: ClerkVerification | null
  linked_to: ClerkLinkedIdentifier[]
  created_at: number
  updated_at: number
}

export interface ClerkPhoneNumber {
  id: string
  object: 'phone_number'
  phone_number: string
  reserved_for_second_factor: boolean
  default_second_factor: boolean
  verification: ClerkVerification | null
  linked_to: ClerkLinkedIdentifier[]
  backup_codes: string[] | null
  created_at: number
  updated_at: number
}

export interface ClerkWeb3Wallet {
  id: string
  object: 'web3_wallet'
  web3_wallet: string
  verification: ClerkVerification | null
  created_at: number
  updated_at: number
}

export interface ClerkExternalAccount {
  id: string
  object: 'external_account'
  provider: string
  identification_id: string
  provider_user_id: string
  approved_scopes: string
  email_address: string
  first_name: string
  last_name: string
  image_url: string
  username: string | null
  public_metadata: Record<string, unknown>
  label: string | null
  verification: ClerkVerification | null
  created_at: number
  updated_at: number
}

export interface ClerkVerification {
  status: string
  strategy: string
  attempts: number | null
  expire_at: number | null
}

export interface ClerkLinkedIdentifier {
  type: string
  id: string
}

/**
 * Clerk Organization object
 */
export interface ClerkOrganization {
  id: string
  object: 'organization'
  name: string
  slug: string
  image_url: string
  has_image: boolean
  members_count?: number
  pending_invitations_count?: number
  max_allowed_memberships: number
  admin_delete_enabled: boolean
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  created_by: string
  created_at: number
  updated_at: number
}

/**
 * Clerk Session object
 */
export interface ClerkSession {
  id: string
  object: 'session'
  user_id: string
  client_id: string
  actor: Record<string, unknown> | null
  status:
    | 'abandoned'
    | 'active'
    | 'ended'
    | 'expired'
    | 'pending'
    | 'removed'
    | 'replaced'
    | 'revoked'
  last_active_organization_id: string | null
  last_active_at: number
  expire_at: number
  abandon_at: number
  created_at: number
  updated_at: number
}

/**
 * Transformed email address for outputs
 */
export interface ClerkEmailAddressOutput {
  id: string
  emailAddress: string
  verified?: boolean
}

/**
 * Transformed phone number for outputs
 */
export interface ClerkPhoneNumberOutput {
  id: string
  phoneNumber: string
  verified?: boolean
}

/**
 * Transformed user for list outputs
 */
export interface ClerkUserOutput {
  id: string
  username: string | null
  firstName: string | null
  lastName: string | null
  imageUrl: string | null
  hasImage: boolean
  primaryEmailAddressId: string | null
  primaryPhoneNumberId: string | null
  emailAddresses: ClerkEmailAddressOutput[]
  phoneNumbers: ClerkPhoneNumberOutput[]
  externalId: string | null
  passwordEnabled: boolean
  twoFactorEnabled: boolean
  banned: boolean
  locked: boolean
  lastSignInAt: number | null
  lastActiveAt: number | null
  createdAt: number
  updatedAt: number
  publicMetadata: Record<string, unknown>
}

/**
 * Transformed organization for outputs
 */
export interface ClerkOrganizationOutput {
  id: string
  name: string
  slug: string | null
  imageUrl: string | null
  hasImage: boolean
  membersCount: number | null
  pendingInvitationsCount: number | null
  maxAllowedMemberships: number
  adminDeleteEnabled: boolean
  createdBy: string | null
  createdAt: number
  updatedAt: number
  publicMetadata: Record<string, unknown>
}

/**
 * Transformed session for outputs
 */
export interface ClerkSessionOutput {
  id: string
  userId: string
  clientId: string
  status: string
  lastActiveAt: number | null
  lastActiveOrganizationId: string | null
  expireAt: number | null
  abandonAt: number | null
  createdAt: number
  updatedAt: number
}

// List Users
export interface ClerkListUsersParams {
  secretKey: string
  limit?: number
  offset?: number
  orderBy?: string
  emailAddress?: string
  phoneNumber?: string
  externalId?: string
  username?: string
  userId?: string
  query?: string
}

export interface ClerkListUsersResponse extends ToolResponse {
  output: {
    users: ClerkUserOutput[]
    totalCount: number
    success: boolean
  }
}

// Get User
export interface ClerkGetUserParams {
  secretKey: string
  userId: string
}

export interface ClerkGetUserResponse extends ToolResponse {
  output: {
    id: string
    username: string | null
    firstName: string | null
    lastName: string | null
    imageUrl: string | null
    hasImage: boolean
    primaryEmailAddressId: string | null
    primaryPhoneNumberId: string | null
    primaryWeb3WalletId: string | null
    emailAddresses: ClerkEmailAddressOutput[]
    phoneNumbers: ClerkPhoneNumberOutput[]
    externalId: string | null
    passwordEnabled: boolean
    twoFactorEnabled: boolean
    totpEnabled: boolean
    backupCodeEnabled: boolean
    banned: boolean
    locked: boolean
    deleteSelfEnabled: boolean
    createOrganizationEnabled: boolean
    lastSignInAt: number | null
    lastActiveAt: number | null
    createdAt: number
    updatedAt: number
    publicMetadata: Record<string, unknown>
    privateMetadata: Record<string, unknown>
    unsafeMetadata: Record<string, unknown>
    success: boolean
  }
}

// Create User
export interface ClerkCreateUserParams {
  secretKey: string
  emailAddress?: string | string[]
  phoneNumber?: string | string[]
  username?: string
  password?: string
  firstName?: string
  lastName?: string
  externalId?: string
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
  unsafeMetadata?: Record<string, unknown>
  skipPasswordChecks?: boolean
  skipPasswordRequirement?: boolean
}

export interface ClerkCreateUserResponse extends ToolResponse {
  output: {
    id: string
    username: string | null
    firstName: string | null
    lastName: string | null
    imageUrl: string | null
    primaryEmailAddressId: string | null
    primaryPhoneNumberId: string | null
    emailAddresses: ClerkEmailAddressOutput[]
    phoneNumbers: ClerkPhoneNumberOutput[]
    externalId: string | null
    createdAt: number
    updatedAt: number
    publicMetadata: Record<string, unknown>
    success: boolean
  }
}

// Update User
export interface ClerkUpdateUserParams {
  secretKey: string
  userId: string
  firstName?: string
  lastName?: string
  username?: string
  password?: string
  externalId?: string
  primaryEmailAddressId?: string
  primaryPhoneNumberId?: string
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
  unsafeMetadata?: Record<string, unknown>
  skipPasswordChecks?: boolean
}

export interface ClerkUpdateUserResponse extends ToolResponse {
  output: {
    id: string
    username: string | null
    firstName: string | null
    lastName: string | null
    imageUrl: string | null
    primaryEmailAddressId: string | null
    primaryPhoneNumberId: string | null
    emailAddresses: ClerkEmailAddressOutput[]
    phoneNumbers: ClerkPhoneNumberOutput[]
    externalId: string | null
    banned: boolean
    locked: boolean
    createdAt: number
    updatedAt: number
    publicMetadata: Record<string, unknown>
    success: boolean
  }
}

// Delete User
export interface ClerkDeleteUserParams {
  secretKey: string
  userId: string
}

export interface ClerkDeleteUserResponse extends ToolResponse {
  output: {
    id: string
    object: string
    deleted: boolean
    success: boolean
  }
}

// List Organizations
export interface ClerkListOrganizationsParams {
  secretKey: string
  limit?: number
  offset?: number
  includeMembersCount?: boolean
  query?: string
  orderBy?: string
}

export interface ClerkListOrganizationsResponse extends ToolResponse {
  output: {
    organizations: ClerkOrganizationOutput[]
    totalCount: number
    success: boolean
  }
}

// Get Organization
export interface ClerkGetOrganizationParams {
  secretKey: string
  organizationId: string
}

export interface ClerkGetOrganizationResponse extends ToolResponse {
  output: {
    id: string
    name: string
    slug: string | null
    imageUrl: string | null
    hasImage: boolean
    membersCount: number | null
    pendingInvitationsCount: number | null
    maxAllowedMemberships: number
    adminDeleteEnabled: boolean
    createdBy: string | null
    createdAt: number
    updatedAt: number
    publicMetadata: Record<string, unknown>
    success: boolean
  }
}

// Create Organization
export interface ClerkCreateOrganizationParams {
  secretKey: string
  name: string
  createdBy: string
  slug?: string
  maxAllowedMemberships?: number
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
}

export interface ClerkCreateOrganizationResponse extends ToolResponse {
  output: {
    id: string
    name: string
    slug: string | null
    imageUrl: string | null
    hasImage: boolean
    membersCount: number | null
    pendingInvitationsCount: number | null
    maxAllowedMemberships: number
    adminDeleteEnabled: boolean
    createdBy: string | null
    createdAt: number
    updatedAt: number
    publicMetadata: Record<string, unknown>
    success: boolean
  }
}

// List Sessions
export interface ClerkListSessionsParams {
  secretKey: string
  userId?: string
  clientId?: string
  status?:
    | 'abandoned'
    | 'active'
    | 'ended'
    | 'expired'
    | 'pending'
    | 'removed'
    | 'replaced'
    | 'revoked'
  limit?: number
  offset?: number
}

export interface ClerkListSessionsResponse extends ToolResponse {
  output: {
    sessions: ClerkSessionOutput[]
    totalCount: number
    success: boolean
  }
}

// Get Session
export interface ClerkGetSessionParams {
  secretKey: string
  sessionId: string
}

export interface ClerkGetSessionResponse extends ToolResponse {
  output: {
    id: string
    userId: string
    clientId: string
    status: string
    lastActiveAt: number | null
    lastActiveOrganizationId: string | null
    expireAt: number | null
    abandonAt: number | null
    createdAt: number
    updatedAt: number
    success: boolean
  }
}

// Revoke Session
export interface ClerkRevokeSessionParams {
  secretKey: string
  sessionId: string
}

export interface ClerkRevokeSessionResponse extends ToolResponse {
  output: {
    id: string
    userId: string
    clientId: string
    status: string
    lastActiveAt: number | null
    lastActiveOrganizationId: string | null
    expireAt: number | null
    abandonAt: number | null
    createdAt: number
    updatedAt: number
    success: boolean
  }
}

// Generic response type for the block
export type ClerkResponse =
  | ClerkListUsersResponse
  | ClerkGetUserResponse
  | ClerkCreateUserResponse
  | ClerkUpdateUserResponse
  | ClerkDeleteUserResponse
  | ClerkListOrganizationsResponse
  | ClerkGetOrganizationResponse
  | ClerkCreateOrganizationResponse
  | ClerkListSessionsResponse
  | ClerkGetSessionResponse
  | ClerkRevokeSessionResponse
