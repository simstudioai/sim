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

interface ClerkWeb3Wallet {
  id: string
  object: 'web3_wallet'
  web3_wallet: string
  verification: ClerkVerification | null
  created_at: number
  updated_at: number
}

interface ClerkExternalAccount {
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

interface ClerkVerification {
  status: string
  strategy: string
  attempts: number | null
  expire_at: number | null
}

interface ClerkLinkedIdentifier {
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
interface ClerkEmailAddressOutput {
  id: string
  emailAddress: string
  verified?: boolean
}

/**
 * Transformed phone number for outputs
 */
interface ClerkPhoneNumberOutput {
  id: string
  phoneNumber: string
  verified?: boolean
}

/**
 * Transformed user for list outputs
 */
interface ClerkUserOutput {
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
interface ClerkOrganizationOutput {
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
interface ClerkSessionOutput {
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

// Update Organization
export interface ClerkUpdateOrganizationParams {
  secretKey: string
  organizationId: string
  name?: string
  slug?: string
  maxAllowedMemberships?: number
  adminDeleteEnabled?: boolean
}

export interface ClerkUpdateOrganizationResponse extends ToolResponse {
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

// Delete Organization
export interface ClerkDeleteOrganizationParams {
  secretKey: string
  organizationId: string
}

export interface ClerkDeleteOrganizationResponse extends ToolResponse {
  output: {
    id: string
    object: string
    deleted: boolean
    success: boolean
  }
}

/**
 * Clerk Organization Membership object.
 * `public_user_data` mirrors the OpenAPI spec (richer than the @clerk/backend SDK's
 * resource class, which omits `username`/`banned`/the deprecated `profile_image_url`).
 */
export interface ClerkOrganizationMembershipPublicUserData {
  user_id: string
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  identifier: string | null
  username?: string | null
  banned?: boolean
}

export interface ClerkOrganizationMembership {
  id: string
  object: 'organization_membership'
  role: string
  role_name?: string
  permissions: string[]
  public_metadata: Record<string, unknown>
  private_metadata?: Record<string, unknown>
  organization: ClerkOrganization
  public_user_data: ClerkOrganizationMembershipPublicUserData
  created_at: number
  updated_at: number
}

interface ClerkOrganizationMembershipOutput {
  id: string
  role: string
  roleName: string | null
  permissions: string[]
  organizationId: string
  userId: string
  firstName: string | null
  lastName: string | null
  imageUrl: string | null
  identifier: string | null
  username: string | null
  banned: boolean
  publicMetadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

// List Organization Memberships
export interface ClerkListOrganizationMembershipsParams {
  secretKey: string
  organizationId: string
  limit?: number
  offset?: number
  orderBy?: string
  role?: string
}

export interface ClerkListOrganizationMembershipsResponse extends ToolResponse {
  output: {
    memberships: ClerkOrganizationMembershipOutput[]
    totalCount: number
    success: boolean
  }
}

// Add Organization Member (create membership)
export interface ClerkAddOrganizationMemberParams {
  secretKey: string
  organizationId: string
  userId: string
  role: string
}

export interface ClerkAddOrganizationMemberResponse extends ToolResponse {
  output: ClerkOrganizationMembershipOutput & { success: boolean }
}

// Update Organization Membership (change role)
export interface ClerkUpdateOrganizationMembershipParams {
  secretKey: string
  organizationId: string
  userId: string
  role: string
}

export interface ClerkUpdateOrganizationMembershipResponse extends ToolResponse {
  output: ClerkOrganizationMembershipOutput & { success: boolean }
}

// Remove Organization Member (delete membership)
export interface ClerkRemoveOrganizationMemberParams {
  secretKey: string
  organizationId: string
  userId: string
}

export interface ClerkRemoveOrganizationMemberResponse extends ToolResponse {
  output: ClerkOrganizationMembershipOutput & { success: boolean }
}

/**
 * Clerk Organization Invitation object.
 */
export interface ClerkOrganizationInvitationPublicUserData {
  user_id: string
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  identifier: string
}

export interface ClerkOrganizationInvitation {
  id: string
  object: 'organization_invitation'
  email_address: string
  role: string
  role_name?: string
  organization_id: string
  inviter_id: string | null
  public_inviter_data: ClerkOrganizationInvitationPublicUserData | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  public_metadata: Record<string, unknown>
  private_metadata?: Record<string, unknown>
  url: string | null
  expires_at: number | null
  created_at: number
  updated_at: number
}

interface ClerkOrganizationInvitationOutput {
  id: string
  emailAddress: string
  role: string
  roleName: string | null
  organizationId: string
  inviterId: string | null
  status: string
  url: string | null
  expiresAt: number | null
  publicMetadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

// Create Organization Invitation
export interface ClerkCreateOrganizationInvitationParams {
  secretKey: string
  organizationId: string
  emailAddress: string
  role: string
  inviterUserId?: string
  redirectUrl?: string
  expiresInDays?: number
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
  notify?: boolean
}

export interface ClerkCreateOrganizationInvitationResponse extends ToolResponse {
  output: ClerkOrganizationInvitationOutput & { success: boolean }
}

// List Organization Invitations
export interface ClerkListOrganizationInvitationsParams {
  secretKey: string
  organizationId: string
  status?: 'pending' | 'accepted' | 'revoked' | 'expired'
  emailAddress?: string
  limit?: number
  offset?: number
}

export interface ClerkListOrganizationInvitationsResponse extends ToolResponse {
  output: {
    invitations: ClerkOrganizationInvitationOutput[]
    totalCount: number
    success: boolean
  }
}

interface ClerkUserModerationOutput {
  id: string
  username: string | null
  firstName: string | null
  lastName: string | null
  banned: boolean
  locked: boolean
  lockoutExpiresInSeconds: number | null
  updatedAt: number
}

// Ban User
export interface ClerkBanUserParams {
  secretKey: string
  userId: string
}

export interface ClerkBanUserResponse extends ToolResponse {
  output: ClerkUserModerationOutput & { success: boolean }
}

// Unban User
export interface ClerkUnbanUserParams {
  secretKey: string
  userId: string
}

export interface ClerkUnbanUserResponse extends ToolResponse {
  output: ClerkUserModerationOutput & { success: boolean }
}

// Lock User
export interface ClerkLockUserParams {
  secretKey: string
  userId: string
}

export interface ClerkLockUserResponse extends ToolResponse {
  output: ClerkUserModerationOutput & { success: boolean }
}

// Unlock User
export interface ClerkUnlockUserParams {
  secretKey: string
  userId: string
}

export interface ClerkUnlockUserResponse extends ToolResponse {
  output: ClerkUserModerationOutput & { success: boolean }
}

/**
 * Clerk OAuth Access Token object.
 */
export interface ClerkOAuthAccessToken {
  object: 'oauth_access_token'
  external_account_id: string
  token: string
  expires_at: number | null
  provider: string
  public_metadata: Record<string, unknown>
  label: string | null
  scopes?: string[]
}

// Get User OAuth Access Token
export interface ClerkGetUserOauthTokenParams {
  secretKey: string
  userId: string
  provider: string
}

export interface ClerkGetUserOauthTokenResponse extends ToolResponse {
  output: {
    accessTokens: {
      externalAccountId: string
      token: string
      expiresAt: number | null
      provider: string
      label: string | null
      scopes: string[]
    }[]
    success: boolean
  }
}

/**
 * Clerk Allowlist/Blocklist Identifier objects.
 */
export interface ClerkAllowlistIdentifier {
  id: string
  object: 'allowlist_identifier'
  identifier: string
  identifier_type: string
  invitation_id?: string | null
  instance_id?: string
  created_at: number
  updated_at: number
}

export interface ClerkBlocklistIdentifier {
  id: string
  object: 'blocklist_identifier'
  identifier: string
  identifier_type: string
  instance_id?: string
  created_at: number
  updated_at: number
}

interface ClerkAllowlistIdentifierOutput {
  id: string
  identifier: string
  identifierType: string
  invitationId: string | null
  createdAt: number
  updatedAt: number
}

interface ClerkBlocklistIdentifierOutput {
  id: string
  identifier: string
  identifierType: string
  createdAt: number
  updatedAt: number
}

// List Allowlist Identifiers
export interface ClerkListAllowlistIdentifiersParams {
  secretKey: string
  limit?: number
  offset?: number
}

export interface ClerkListAllowlistIdentifiersResponse extends ToolResponse {
  output: {
    identifiers: ClerkAllowlistIdentifierOutput[]
    totalCount: number
    success: boolean
  }
}

// Create Allowlist Identifier
export interface ClerkCreateAllowlistIdentifierParams {
  secretKey: string
  identifier: string
  notify?: boolean
}

export interface ClerkCreateAllowlistIdentifierResponse extends ToolResponse {
  output: ClerkAllowlistIdentifierOutput & { success: boolean }
}

// Delete Allowlist Identifier
export interface ClerkDeleteAllowlistIdentifierParams {
  secretKey: string
  identifierId: string
}

export interface ClerkDeleteAllowlistIdentifierResponse extends ToolResponse {
  output: {
    id: string
    object: string
    deleted: boolean
    success: boolean
  }
}

// List Blocklist Identifiers
export interface ClerkListBlocklistIdentifiersParams {
  secretKey: string
  limit?: number
  offset?: number
}

export interface ClerkListBlocklistIdentifiersResponse extends ToolResponse {
  output: {
    identifiers: ClerkBlocklistIdentifierOutput[]
    totalCount: number
    success: boolean
  }
}

// Create Blocklist Identifier
export interface ClerkCreateBlocklistIdentifierParams {
  secretKey: string
  identifier: string
}

export interface ClerkCreateBlocklistIdentifierResponse extends ToolResponse {
  output: ClerkBlocklistIdentifierOutput & { success: boolean }
}

// Delete Blocklist Identifier
export interface ClerkDeleteBlocklistIdentifierParams {
  secretKey: string
  identifierId: string
}

export interface ClerkDeleteBlocklistIdentifierResponse extends ToolResponse {
  output: {
    id: string
    object: string
    deleted: boolean
    success: boolean
  }
}

/**
 * Clerk JWT Template object. The signing key is write-only and never echoed back.
 */
export interface ClerkJwtTemplate {
  id: string
  object: 'jwt_template'
  name: string
  claims: Record<string, unknown>
  lifetime: number
  allowed_clock_skew: number
  custom_signing_key: boolean
  signing_algorithm: string
  created_at: number
  updated_at: number
}

interface ClerkJwtTemplateOutput {
  id: string
  name: string
  claims: Record<string, unknown>
  lifetime: number
  allowedClockSkew: number
  customSigningKey: boolean
  signingAlgorithm: string
  createdAt: number
  updatedAt: number
}

// List JWT Templates
export interface ClerkListJwtTemplatesParams {
  secretKey: string
}

export interface ClerkListJwtTemplatesResponse extends ToolResponse {
  output: {
    templates: ClerkJwtTemplateOutput[]
    totalCount: number
    success: boolean
  }
}

// Get JWT Template
export interface ClerkGetJwtTemplateParams {
  secretKey: string
  templateId: string
}

export interface ClerkGetJwtTemplateResponse extends ToolResponse {
  output: ClerkJwtTemplateOutput & { success: boolean }
}

/**
 * Clerk Actor Token object. `token`/`url` are only present on creation,
 * not once the token has been consumed or revoked.
 */
export interface ClerkActorToken {
  id: string
  object: 'actor_token'
  status: 'pending' | 'accepted' | 'revoked'
  user_id: string
  actor: Record<string, unknown>
  token?: string | null
  url?: string | null
  created_at: number
  updated_at: number
}

interface ClerkActorTokenOutput {
  id: string
  status: string
  userId: string
  actor: Record<string, unknown>
  token: string | null
  url: string | null
  createdAt: number
  updatedAt: number
}

// Create Actor Token
export interface ClerkCreateActorTokenParams {
  secretKey: string
  userId: string
  actor: Record<string, unknown>
  expiresInSeconds?: number
  sessionMaxDurationInSeconds?: number
}

export interface ClerkCreateActorTokenResponse extends ToolResponse {
  output: ClerkActorTokenOutput & { success: boolean }
}

// Revoke Actor Token
export interface ClerkRevokeActorTokenParams {
  secretKey: string
  actorTokenId: string
}

export interface ClerkRevokeActorTokenResponse extends ToolResponse {
  output: ClerkActorTokenOutput & { success: boolean }
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
  | ClerkUpdateOrganizationResponse
  | ClerkDeleteOrganizationResponse
  | ClerkListSessionsResponse
  | ClerkGetSessionResponse
  | ClerkRevokeSessionResponse
  | ClerkListOrganizationMembershipsResponse
  | ClerkAddOrganizationMemberResponse
  | ClerkUpdateOrganizationMembershipResponse
  | ClerkRemoveOrganizationMemberResponse
  | ClerkCreateOrganizationInvitationResponse
  | ClerkListOrganizationInvitationsResponse
  | ClerkBanUserResponse
  | ClerkUnbanUserResponse
  | ClerkLockUserResponse
  | ClerkUnlockUserResponse
  | ClerkGetUserOauthTokenResponse
  | ClerkListAllowlistIdentifiersResponse
  | ClerkCreateAllowlistIdentifierResponse
  | ClerkDeleteAllowlistIdentifierResponse
  | ClerkListBlocklistIdentifiersResponse
  | ClerkCreateBlocklistIdentifierResponse
  | ClerkDeleteBlocklistIdentifierResponse
  | ClerkListJwtTemplatesResponse
  | ClerkGetJwtTemplateResponse
  | ClerkCreateActorTokenResponse
  | ClerkRevokeActorTokenResponse
