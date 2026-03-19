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
export interface OktaBaseParams {
  apiKey: string
  domain: string
}

/**
 * Okta User profile object from the API
 */
export interface OktaUserProfile {
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
 * Okta Group profile from the API
 */
export interface OktaGroupProfile {
  name: string
  description?: string | null
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
export interface OktaUserOutput {
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
export interface OktaGroupOutput {
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
  limit?: number
}

export interface OktaListUsersResponse extends ToolResponse {
  output: {
    users: OktaUserOutput[]
    count: number
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
  limit?: number
}

export interface OktaListGroupsResponse extends ToolResponse {
  output: {
    groups: OktaGroupOutput[]
    count: number
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
  limit?: number
}

export interface OktaListGroupMembersResponse extends ToolResponse {
  output: {
    members: OktaUserOutput[]
    count: number
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
  name: string
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
