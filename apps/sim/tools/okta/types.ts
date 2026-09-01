import type { ToolResponse } from '@/tools/types'

/**
 * Okta API error response
 */
export interface OktaApiError {
  errorCode?: string
  errorSummary?: string
  errorCauses?: { errorSummary: string }[]
}

/**
 * Common params for all Okta tools
 */
interface OktaBaseParams {
  apiKey: string
  domain: string
}

/**
 * Okta User profile object from the API
 */
interface OktaUserProfile {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  login?: string | null
  mobilePhone?: string | null
  secondEmail?: string | null
  displayName?: string | null
  nickName?: string | null
  title?: string | null
  department?: string | null
  organization?: string | null
  manager?: string | null
  managerId?: string | null
  division?: string | null
  costCenter?: string | null
  employeeNumber?: string | null
  userType?: string | null
}

/**
 * Okta User object from the API
 */
export interface OktaUser {
  id: string
  status: string
  created: string
  activated: string | null
  statusChanged: string | null
  lastLogin: string | null
  lastUpdated: string
  passwordChanged: string | null
  type: { id: string }
  profile: OktaUserProfile
}

/**
 * Okta Group profile from the API.
 *
 * Okta's group profile is extensible — orgs add custom attributes through the
 * Schemas API — so the index signature is what keeps those attributes alive
 * across a read-modify-write instead of dropping them.
 */
export interface OktaGroupProfile {
  name: string
  description?: string | null
  [attribute: string]: unknown
}

/**
 * Okta Group object from the API
 */
export interface OktaGroup {
  id: string
  created: string
  lastUpdated: string
  lastMembershipUpdated: string | null
  type: string
  profile: OktaGroupProfile
}

/**
 * Transformed user output
 */
interface OktaUserOutput {
  id: string
  status: string
  firstName: string | null
  lastName: string | null
  email: string | null
  login: string | null
  mobilePhone: string | null
  title: string | null
  department: string | null
  created: string
  lastLogin: string | null
  lastUpdated: string
  activated: string | null
  statusChanged: string | null
}

/**
 * Transformed group output
 */
interface OktaGroupOutput {
  id: string
  name: string
  description: string | null
  type: string
  created: string
  lastUpdated: string
  lastMembershipUpdated: string | null
}

// List Users
export interface OktaListUsersParams extends OktaBaseParams {
  search?: string
  filter?: string
  after?: string
  limit?: number
}

export interface OktaListUsersResponse extends ToolResponse {
  output: {
    users: OktaUserOutput[]
    count: number
    nextCursor: string | null
    hasMore: boolean
    success: boolean
  }
}

// Get User
export interface OktaGetUserParams extends OktaBaseParams {
  userId: string
}

export interface OktaGetUserResponse extends ToolResponse {
  output: {
    id: string
    status: string
    firstName: string | null
    lastName: string | null
    email: string | null
    login: string | null
    mobilePhone: string | null
    secondEmail: string | null
    displayName: string | null
    title: string | null
    department: string | null
    organization: string | null
    manager: string | null
    managerId: string | null
    division: string | null
    employeeNumber: string | null
    userType: string | null
    created: string
    activated: string | null
    lastLogin: string | null
    lastUpdated: string
    statusChanged: string | null
    passwordChanged: string | null
    success: boolean
  }
}

// Create User
export interface OktaCreateUserParams extends OktaBaseParams {
  firstName: string
  lastName: string
  email: string
  login?: string
  password?: string
  mobilePhone?: string
  title?: string
  department?: string
  activate?: boolean
}

export interface OktaCreateUserResponse extends ToolResponse {
  output: {
    id: string
    status: string
    firstName: string | null
    lastName: string | null
    email: string | null
    login: string | null
    created: string
    lastUpdated: string
    success: boolean
  }
}

// Update User
export interface OktaUpdateUserParams extends OktaBaseParams {
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  login?: string
  mobilePhone?: string
  title?: string
  department?: string
}

export interface OktaUpdateUserResponse extends ToolResponse {
  output: {
    id: string
    status: string
    firstName: string | null
    lastName: string | null
    email: string | null
    login: string | null
    created: string
    lastUpdated: string
    success: boolean
  }
}

// Deactivate User
export interface OktaDeactivateUserParams extends OktaBaseParams {
  userId: string
  sendEmail?: boolean
}

export interface OktaDeactivateUserResponse extends ToolResponse {
  output: {
    userId: string
    deactivated: boolean
    success: boolean
  }
}

// List Groups
export interface OktaListGroupsParams extends OktaBaseParams {
  search?: string
  filter?: string
  after?: string
  limit?: number
}

export interface OktaListGroupsResponse extends ToolResponse {
  output: {
    groups: OktaGroupOutput[]
    count: number
    nextCursor: string | null
    hasMore: boolean
    success: boolean
  }
}

// Get Group
export interface OktaGetGroupParams extends OktaBaseParams {
  groupId: string
}

export interface OktaGetGroupResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    type: string
    created: string
    lastUpdated: string
    lastMembershipUpdated: string | null
    success: boolean
  }
}

// Add User to Group
export interface OktaAddUserToGroupParams extends OktaBaseParams {
  groupId: string
  userId: string
}

export interface OktaAddUserToGroupResponse extends ToolResponse {
  output: {
    groupId: string
    userId: string
    added: boolean
    success: boolean
  }
}

// Remove User from Group
export interface OktaRemoveUserFromGroupParams extends OktaBaseParams {
  groupId: string
  userId: string
}

export interface OktaRemoveUserFromGroupResponse extends ToolResponse {
  output: {
    groupId: string
    userId: string
    removed: boolean
    success: boolean
  }
}

// List Group Members
export interface OktaListGroupMembersParams extends OktaBaseParams {
  groupId: string
  after?: string
  limit?: number
}

export interface OktaListGroupMembersResponse extends ToolResponse {
  output: {
    members: OktaUserOutput[]
    count: number
    nextCursor: string | null
    hasMore: boolean
    success: boolean
  }
}

// Suspend User
export interface OktaSuspendUserParams extends OktaBaseParams {
  userId: string
}

export interface OktaSuspendUserResponse extends ToolResponse {
  output: {
    userId: string
    suspended: boolean
    success: boolean
  }
}

// Unsuspend User
export interface OktaUnsuspendUserParams extends OktaBaseParams {
  userId: string
}

export interface OktaUnsuspendUserResponse extends ToolResponse {
  output: {
    userId: string
    unsuspended: boolean
    success: boolean
  }
}

// Activate User
export interface OktaActivateUserParams extends OktaBaseParams {
  userId: string
  sendEmail?: boolean
}

export interface OktaActivateUserResponse extends ToolResponse {
  output: {
    userId: string
    activated: boolean
    activationUrl: string | null
    activationToken: string | null
    success: boolean
  }
}

// Reset Password
export interface OktaResetPasswordParams extends OktaBaseParams {
  userId: string
  sendEmail?: boolean
}

export interface OktaResetPasswordResponse extends ToolResponse {
  output: {
    userId: string
    resetPasswordUrl: string | null
    success: boolean
  }
}

// Delete User
export interface OktaDeleteUserParams extends OktaBaseParams {
  userId: string
  sendEmail?: boolean
}

export interface OktaDeleteUserResponse extends ToolResponse {
  output: {
    userId: string
    deleted: boolean
    success: boolean
  }
}

// Create Group
export interface OktaCreateGroupParams extends OktaBaseParams {
  name: string
  description?: string
}

export interface OktaCreateGroupResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    type: string
    created: string
    lastUpdated: string
    lastMembershipUpdated: string | null
    success: boolean
  }
}

// Update Group
export interface OktaUpdateGroupParams extends OktaBaseParams {
  groupId: string
  name?: string
  description?: string
}

export interface OktaUpdateGroupResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
    type: string
    created: string
    lastUpdated: string
    lastMembershipUpdated: string | null
    success: boolean
  }
}

// Delete Group
export interface OktaDeleteGroupParams extends OktaBaseParams {
  groupId: string
}

export interface OktaDeleteGroupResponse extends ToolResponse {
  output: {
    groupId: string
    deleted: boolean
    success: boolean
  }
}

/**
 * Okta Application object from the API.
 *
 * `accessibility`, `visibility`, `settings`, and `profile` are polymorphic per
 * `signOnMode`, so they stay untyped maps rather than a guessed fixed shape.
 */
export interface OktaApplication {
  id: string
  name: string
  label: string
  status: string
  signOnMode: string
  features?: string[] | null
  created: string
  lastUpdated: string
  accessibility?: Record<string, unknown> | null
  visibility?: Record<string, unknown> | null
  settings?: Record<string, unknown> | null
  profile?: Record<string, unknown> | null
}

/**
 * Transformed application summary output
 */
interface OktaApplicationOutput {
  id: string
  name: string
  label: string
  status: string
  signOnMode: string
  features: string[]
  created: string
  lastUpdated: string
}

/**
 * Okta Application User (assignment) object from the API
 */
export interface OktaAppUser {
  id: string
  externalId?: string | null
  created: string
  lastUpdated: string
  scope: string
  status: string
  statusChanged?: string | null
  passwordChanged?: string | null
  syncState?: string | null
  lastSync?: string | null
  credentials?: { userName?: string | null } | null
  profile?: Record<string, unknown> | null
}

/**
 * Transformed application user output
 */
interface OktaAppUserOutput {
  id: string
  externalId: string | null
  created: string
  lastUpdated: string
  scope: string
  status: string
  statusChanged: string | null
  passwordChanged: string | null
  syncState: string | null
  lastSync: string | null
  userName: string | null
  profile: Record<string, unknown> | null
}

/**
 * Okta Application Group Assignment object from the API
 */
export interface OktaAppGroupAssignment {
  id: string
  priority?: number | null
  lastUpdated: string
  profile?: Record<string, unknown> | null
}

/**
 * Transformed application group assignment output
 */
interface OktaAppGroupOutput {
  id: string
  priority: number | null
  lastUpdated: string
  profile: Record<string, unknown> | null
}

/**
 * Okta admin role assignment object.
 *
 * Standard and custom assignments form a union discriminated on `type`. A custom
 * assignment is a resource-set binding, so its `id` is the binding id and it
 * carries `role` plus the hyphenated `resource-set` rather than a label alone.
 */
export interface OktaRoleAssignment {
  id?: string | null
  label?: string | null
  type: string
  status?: string | null
  created?: string | null
  lastUpdated?: string | null
  assignmentType?: string | null
  role?: string | null
  'resource-set'?: string | null
}

/**
 * Transformed admin role assignment output
 */
interface OktaRoleAssignmentOutput {
  id: string | null
  label: string | null
  type: string
  status: string | null
  created: string | null
  lastUpdated: string | null
  assignmentType: string | null
  role: string | null
  resourceSet: string | null
}

/**
 * Okta Group Rule object from the API
 */
export interface OktaGroupRule {
  id: string
  name: string
  type: string
  status: string
  created?: string | null
  lastUpdated?: string | null
  conditions?: {
    expression?: { type?: string | null; value?: string | null } | null
    people?: {
      users?: { exclude?: string[] | null } | null
      groups?: { exclude?: string[] | null } | null
    } | null
  } | null
  actions?: { assignUserToGroups?: { groupIds?: string[] | null } | null } | null
}

/**
 * Transformed group rule output
 */
interface OktaGroupRuleOutput {
  id: string
  name: string
  type: string
  status: string
  created: string | null
  lastUpdated: string | null
  expression: string | null
  expressionType: string | null
  assignUserToGroupIds: string[]
  excludedUserIds: string[]
  excludedGroupIds: string[]
}

/**
 * Okta System Log event object from the API
 */
export interface OktaLogEvent {
  uuid: string
  published: string
  eventType: string
  severity: string
  legacyEventType?: string | null
  displayMessage?: string | null
  actor?: {
    id?: string | null
    type?: string | null
    alternateId?: string | null
    displayName?: string | null
  } | null
  client?: {
    id?: string | null
    ipAddress?: string | null
    device?: string | null
    zone?: string | null
    userAgent?: { browser?: string | null; os?: string | null; rawUserAgent?: string | null } | null
    geographicalContext?: {
      city?: string | null
      state?: string | null
      country?: string | null
    } | null
  } | null
  authenticationContext?: {
    externalSessionId?: string | null
    authenticationProvider?: string | null
    credentialProvider?: string | null
    credentialType?: string | null
    interface?: string | null
  } | null
  securityContext?: {
    asOrg?: string | null
    isp?: string | null
    domain?: string | null
    isProxy?: boolean | null
  } | null
  target?:
    | {
        id?: string | null
        type?: string | null
        alternateId?: string | null
        displayName?: string | null
      }[]
    | null
  transaction?: { id?: string | null; type?: string | null } | null
  debugContext?: { debugData?: Record<string, unknown> | null } | null
  outcome?: { result?: string | null; reason?: string | null } | null
}

/**
 * Transformed System Log event output
 */
interface OktaLogEventOutput {
  uuid: string
  published: string
  eventType: string
  severity: string
  legacyEventType: string | null
  displayMessage: string | null
  outcomeResult: string | null
  outcomeReason: string | null
  actorId: string | null
  actorType: string | null
  actorAlternateId: string | null
  actorDisplayName: string | null
  clientIpAddress: string | null
  clientDevice: string | null
  clientZone: string | null
  clientBrowser: string | null
  clientOs: string | null
  clientCity: string | null
  clientState: string | null
  clientCountry: string | null
  authenticationProvider: string | null
  credentialType: string | null
  externalSessionId: string | null
  securityAsOrg: string | null
  securityIsp: string | null
  securityIsProxy: boolean | null
  transactionId: string | null
  transactionType: string | null
  targets: {
    id: string | null
    type: string | null
    alternateId: string | null
    displayName: string | null
  }[]
  debugData: Record<string, unknown> | null
}

/**
 * Okta Session object from the API
 */
export interface OktaSession {
  id: string
  login?: string | null
  userId?: string | null
  status?: string | null
  createdAt?: string | null
  expiresAt?: string | null
  lastPasswordVerification?: string | null
  lastFactorVerification?: string | null
  amr?: string[] | null
  idp?: { id?: string | null; type?: string | null } | null
}

/**
 * Okta UserFactor object from the API.
 *
 * `profile` is a discriminated union keyed on `factorType` (phone number for
 * `sms`/`call`, email for `email`, question/answer for `question`, credential id
 * for the token families), so it stays an untyped map rather than one guessed
 * shape. `_embedded` is free-form in the schema and is not surfaced.
 */
export interface OktaFactor {
  id: string
  factorType: string
  provider?: string | null
  vendorName?: string | null
  status?: string | null
  created?: string | null
  lastUpdated?: string | null
  profile?: Record<string, unknown> | null
}

/**
 * Transformed factor output
 */
interface OktaFactorOutput {
  id: string
  factorType: string
  provider: string | null
  vendorName: string | null
  status: string | null
  created: string | null
  lastUpdated: string | null
  profile: Record<string, unknown> | null
}

// List Factors
export interface OktaListFactorsParams extends OktaBaseParams {
  userId: string
}

export interface OktaListFactorsResponse extends ToolResponse {
  output: {
    factors: OktaFactorOutput[]
    count: number
    success: boolean
  }
}

// Get Factor
export interface OktaGetFactorParams extends OktaBaseParams {
  userId: string
  factorId: string
}

export interface OktaGetFactorResponse extends ToolResponse {
  output: OktaFactorOutput & { success: boolean }
}

// Reset Factor
export interface OktaResetFactorParams extends OktaBaseParams {
  userId: string
  factorId: string
  removeRecoveryEnrollment?: boolean
}

export interface OktaResetFactorResponse extends ToolResponse {
  output: {
    userId: string
    factorId: string
    reset: boolean
    success: boolean
  }
}

// Reset All Factors
export interface OktaResetAllFactorsParams extends OktaBaseParams {
  userId: string
}

export interface OktaResetAllFactorsResponse extends ToolResponse {
  output: {
    userId: string
    reset: boolean
    success: boolean
  }
}

// Enroll Factor
export interface OktaEnrollFactorParams extends OktaBaseParams {
  userId: string
  factorType: string
  provider: string
  phoneNumber?: string
  factorEmail?: string
  securityQuestion?: string
  securityAnswer?: string
  activate?: boolean
}

export interface OktaEnrollFactorResponse extends ToolResponse {
  output: OktaFactorOutput & { enrolled: boolean; success: boolean }
}

// Get Logs
export interface OktaGetLogsParams extends OktaBaseParams {
  since?: string
  until?: string
  filter?: string
  q?: string
  sortOrder?: string
  after?: string
  limit?: number
}

export interface OktaGetLogsResponse extends ToolResponse {
  output: {
    events: OktaLogEventOutput[]
    count: number
    nextCursor: string | null
    hasMore: boolean
    success: boolean
  }
}

// Clear User Sessions
export interface OktaClearUserSessionsParams extends OktaBaseParams {
  userId: string
  oauthTokens?: boolean
  forgetDevices?: boolean
}

export interface OktaClearUserSessionsResponse extends ToolResponse {
  output: {
    userId: string
    cleared: boolean
    success: boolean
  }
}

// Get Session
export interface OktaGetSessionParams extends OktaBaseParams {
  sessionId: string
}

export interface OktaGetSessionResponse extends ToolResponse {
  output: {
    id: string
    login: string | null
    userId: string | null
    status: string | null
    createdAt: string | null
    expiresAt: string | null
    lastPasswordVerification: string | null
    lastFactorVerification: string | null
    amr: string[]
    idpId: string | null
    idpType: string | null
    success: boolean
  }
}

// Revoke Session
export interface OktaRevokeSessionParams extends OktaBaseParams {
  sessionId: string
}

export interface OktaRevokeSessionResponse extends ToolResponse {
  output: {
    sessionId: string
    revoked: boolean
    success: boolean
  }
}

// List Applications
export interface OktaListAppsParams extends OktaBaseParams {
  q?: string
  filter?: string
  includeNonDeleted?: boolean
  after?: string
  limit?: number
}

export interface OktaListAppsResponse extends ToolResponse {
  output: {
    apps: OktaApplicationOutput[]
    count: number
    nextCursor: string | null
    hasMore: boolean
    success: boolean
  }
}

// Get Application
export interface OktaGetAppParams extends OktaBaseParams {
  appId: string
}

export interface OktaGetAppResponse extends ToolResponse {
  output: {
    id: string
    name: string
    label: string
    status: string
    signOnMode: string
    features: string[]
    created: string
    lastUpdated: string
    accessibility: Record<string, unknown> | null
    visibility: Record<string, unknown> | null
    settings: Record<string, unknown> | null
    profile: Record<string, unknown> | null
    success: boolean
  }
}

// List Application Users
export interface OktaListAppUsersParams extends OktaBaseParams {
  appId: string
  q?: string
  after?: string
  limit?: number
}

export interface OktaListAppUsersResponse extends ToolResponse {
  output: {
    appUsers: OktaAppUserOutput[]
    count: number
    nextCursor: string | null
    hasMore: boolean
    success: boolean
  }
}

// Assign User to Application
export interface OktaAssignUserToAppParams extends OktaBaseParams {
  appId: string
  userId: string
  scope?: string
  appUserName?: string
}

export interface OktaAssignUserToAppResponse extends ToolResponse {
  output: OktaAppUserOutput & { assigned: boolean; success: boolean }
}

// Remove User from Application
export interface OktaRemoveUserFromAppParams extends OktaBaseParams {
  appId: string
  userId: string
  sendEmail?: boolean
}

export interface OktaRemoveUserFromAppResponse extends ToolResponse {
  output: {
    appId: string
    userId: string
    removed: boolean
    success: boolean
  }
}

// List Application Groups
export interface OktaListAppGroupsParams extends OktaBaseParams {
  appId: string
  q?: string
  after?: string
  limit?: number
}

export interface OktaListAppGroupsResponse extends ToolResponse {
  output: {
    appGroups: OktaAppGroupOutput[]
    count: number
    nextCursor: string | null
    hasMore: boolean
    success: boolean
  }
}

// Assign Group to Application
export interface OktaAssignGroupToAppParams extends OktaBaseParams {
  appId: string
  groupId: string
  priority?: number
}

export interface OktaAssignGroupToAppResponse extends ToolResponse {
  output: {
    id: string
    priority: number | null
    lastUpdated: string
    profile: Record<string, unknown> | null
    assigned: boolean
    success: boolean
  }
}

// Remove Group from Application
export interface OktaRemoveGroupFromAppParams extends OktaBaseParams {
  appId: string
  groupId: string
}

export interface OktaRemoveGroupFromAppResponse extends ToolResponse {
  output: {
    appId: string
    groupId: string
    removed: boolean
    success: boolean
  }
}

// List User Roles
export interface OktaListUserRolesParams extends OktaBaseParams {
  userId: string
}

export interface OktaListUserRolesResponse extends ToolResponse {
  output: {
    roles: OktaRoleAssignmentOutput[]
    count: number
    success: boolean
  }
}

// Assign User Role
export interface OktaAssignUserRoleParams extends OktaBaseParams {
  userId: string
  roleType: string
  customRoleId?: string
  resourceSetId?: string
  disableNotifications?: boolean
}

export interface OktaAssignUserRoleResponse extends ToolResponse {
  output: OktaRoleAssignmentOutput & { assigned: boolean; success: boolean }
}

// Remove User Role
export interface OktaRemoveUserRoleParams extends OktaBaseParams {
  userId: string
  roleAssignmentId: string
}

export interface OktaRemoveUserRoleResponse extends ToolResponse {
  output: {
    userId: string
    roleAssignmentId: string
    removed: boolean
    success: boolean
  }
}

// List Group Rules
export interface OktaListGroupRulesParams extends OktaBaseParams {
  search?: string
  after?: string
  limit?: number
}

export interface OktaListGroupRulesResponse extends ToolResponse {
  output: {
    rules: OktaGroupRuleOutput[]
    count: number
    nextCursor: string | null
    hasMore: boolean
    success: boolean
  }
}

// Get Group Rule
export interface OktaGetGroupRuleParams extends OktaBaseParams {
  groupRuleId: string
}

export interface OktaGetGroupRuleResponse extends ToolResponse {
  output: OktaGroupRuleOutput & { success: boolean }
}

// Create Group Rule
export interface OktaCreateGroupRuleParams extends OktaBaseParams {
  ruleName: string
  expression: string
  assignUserToGroupIds: string
  excludedUserIds?: string
}

export interface OktaCreateGroupRuleResponse extends ToolResponse {
  output: OktaGroupRuleOutput & { success: boolean }
}

// Activate Group Rule
export interface OktaActivateGroupRuleParams extends OktaBaseParams {
  groupRuleId: string
}

export interface OktaActivateGroupRuleResponse extends ToolResponse {
  output: {
    groupRuleId: string
    activated: boolean
    success: boolean
  }
}

// Deactivate Group Rule
export interface OktaDeactivateGroupRuleParams extends OktaBaseParams {
  groupRuleId: string
}

export interface OktaDeactivateGroupRuleResponse extends ToolResponse {
  output: {
    groupRuleId: string
    deactivated: boolean
    success: boolean
  }
}

// Delete Group Rule
export interface OktaDeleteGroupRuleParams extends OktaBaseParams {
  groupRuleId: string
  removeUsers?: boolean
}

export interface OktaDeleteGroupRuleResponse extends ToolResponse {
  output: {
    groupRuleId: string
    deleted: boolean
    success: boolean
  }
}

// Generic response type for the block
export type OktaResponse =
  | OktaListUsersResponse
  | OktaGetUserResponse
  | OktaCreateUserResponse
  | OktaUpdateUserResponse
  | OktaDeactivateUserResponse
  | OktaSuspendUserResponse
  | OktaUnsuspendUserResponse
  | OktaActivateUserResponse
  | OktaResetPasswordResponse
  | OktaDeleteUserResponse
  | OktaListGroupsResponse
  | OktaGetGroupResponse
  | OktaCreateGroupResponse
  | OktaUpdateGroupResponse
  | OktaDeleteGroupResponse
  | OktaAddUserToGroupResponse
  | OktaRemoveUserFromGroupResponse
  | OktaListGroupMembersResponse
  | OktaGetLogsResponse
  | OktaClearUserSessionsResponse
  | OktaGetSessionResponse
  | OktaRevokeSessionResponse
  | OktaListFactorsResponse
  | OktaGetFactorResponse
  | OktaResetFactorResponse
  | OktaResetAllFactorsResponse
  | OktaEnrollFactorResponse
  | OktaListAppsResponse
  | OktaGetAppResponse
  | OktaListAppUsersResponse
  | OktaAssignUserToAppResponse
  | OktaRemoveUserFromAppResponse
  | OktaListAppGroupsResponse
  | OktaAssignGroupToAppResponse
  | OktaRemoveGroupFromAppResponse
  | OktaListUserRolesResponse
  | OktaAssignUserRoleResponse
  | OktaRemoveUserRoleResponse
  | OktaListGroupRulesResponse
  | OktaGetGroupRuleResponse
  | OktaCreateGroupRuleResponse
  | OktaActivateGroupRuleResponse
  | OktaDeactivateGroupRuleResponse
  | OktaDeleteGroupRuleResponse
