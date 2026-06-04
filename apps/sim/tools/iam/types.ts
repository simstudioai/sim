import type { ToolResponse } from '@/tools/types'

export interface IAMConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface IAMListUsersParams extends IAMConnectionConfig {
  pathPrefix?: string | null
  maxItems?: number | null
  marker?: string | null
}

export interface IAMGetUserParams extends IAMConnectionConfig {
  userName?: string | null
}

export interface IAMCreateUserParams extends IAMConnectionConfig {
  userName: string
  path?: string | null
}

export interface IAMDeleteUserParams extends IAMConnectionConfig {
  userName: string
}

export interface IAMListRolesParams extends IAMConnectionConfig {
  pathPrefix?: string | null
  maxItems?: number | null
  marker?: string | null
}

export interface IAMGetRoleParams extends IAMConnectionConfig {
  roleName: string
}

export interface IAMCreateRoleParams extends IAMConnectionConfig {
  roleName: string
  assumeRolePolicyDocument: string
  description?: string | null
  path?: string | null
  maxSessionDuration?: number | null
}

export interface IAMDeleteRoleParams extends IAMConnectionConfig {
  roleName: string
}

export interface IAMAttachUserPolicyParams extends IAMConnectionConfig {
  userName: string
  policyArn: string
}

export interface IAMDetachUserPolicyParams extends IAMConnectionConfig {
  userName: string
  policyArn: string
}

export interface IAMAttachRolePolicyParams extends IAMConnectionConfig {
  roleName: string
  policyArn: string
}

export interface IAMDetachRolePolicyParams extends IAMConnectionConfig {
  roleName: string
  policyArn: string
}

export interface IAMListPoliciesParams extends IAMConnectionConfig {
  scope?: string | null
  onlyAttached?: boolean | null
  pathPrefix?: string | null
  maxItems?: number | null
  marker?: string | null
}

export interface IAMCreateAccessKeyParams extends IAMConnectionConfig {
  userName?: string | null
}

export interface IAMDeleteAccessKeyParams extends IAMConnectionConfig {
  accessKeyIdToDelete: string
  userName?: string | null
}

export interface IAMListGroupsParams extends IAMConnectionConfig {
  pathPrefix?: string | null
  maxItems?: number | null
  marker?: string | null
}

export interface IAMAddUserToGroupParams extends IAMConnectionConfig {
  userName: string
  groupName: string
}

export interface IAMRemoveUserFromGroupParams extends IAMConnectionConfig {
  userName: string
  groupName: string
}

export interface IAMBaseResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface IAMListUsersResponse extends ToolResponse {
  output: {
    users: Array<{
      userName: string
      userId: string
      arn: string
      path: string
      createDate: string | null
      passwordLastUsed: string | null
    }>
    isTruncated: boolean
    marker: string | null
    count: number
  }
  error?: string
}

export interface IAMGetUserResponse extends ToolResponse {
  output: {
    userName: string
    userId: string
    arn: string
    path: string
    createDate: string | null
    passwordLastUsed: string | null
    permissionsBoundaryArn: string | null
    tags: Array<{ key: string; value: string }>
  }
  error?: string
}

export interface IAMCreateUserResponse extends ToolResponse {
  output: {
    message: string
    userName: string
    userId: string
    arn: string
    path: string
    createDate: string | null
  }
  error?: string
}

export interface IAMDeleteUserResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface IAMListRolesResponse extends ToolResponse {
  output: {
    roles: Array<{
      roleName: string
      roleId: string
      arn: string
      path: string
      createDate: string | null
      description: string | null
      maxSessionDuration: number | null
    }>
    isTruncated: boolean
    marker: string | null
    count: number
  }
  error?: string
}

export interface IAMGetRoleResponse extends ToolResponse {
  output: {
    roleName: string
    roleId: string
    arn: string
    path: string
    createDate: string | null
    description: string | null
    maxSessionDuration: number | null
    assumeRolePolicyDocument: string | null
    roleLastUsedDate: string | null
    roleLastUsedRegion: string | null
  }
  error?: string
}

export interface IAMCreateRoleResponse extends ToolResponse {
  output: {
    message: string
    roleName: string
    roleId: string
    arn: string
    path: string
    createDate: string | null
  }
  error?: string
}

export interface IAMDeleteRoleResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface IAMAttachPolicyResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface IAMDetachPolicyResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface IAMListPoliciesResponse extends ToolResponse {
  output: {
    policies: Array<{
      policyName: string
      policyId: string
      arn: string
      path: string
      attachmentCount: number
      isAttachable: boolean
      createDate: string | null
      updateDate: string | null
      description: string | null
      defaultVersionId: string | null
      permissionsBoundaryUsageCount: number
    }>
    isTruncated: boolean
    marker: string | null
    count: number
  }
  error?: string
}

export interface IAMCreateAccessKeyResponse extends ToolResponse {
  output: {
    message: string
    accessKeyId: string
    secretAccessKey: string
    userName: string
    status: string
    createDate: string | null
  }
  error?: string
}

export interface IAMDeleteAccessKeyResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface IAMListGroupsResponse extends ToolResponse {
  output: {
    groups: Array<{
      groupName: string
      groupId: string
      arn: string
      path: string
      createDate: string | null
    }>
    isTruncated: boolean
    marker: string | null
    count: number
  }
  error?: string
}

export interface IAMGroupMembershipResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface IAMListAttachedRolePoliciesParams extends IAMConnectionConfig {
  roleName: string
  pathPrefix?: string | null
  maxItems?: number | null
  marker?: string | null
}

export interface IAMListAttachedUserPoliciesParams extends IAMConnectionConfig {
  userName: string
  pathPrefix?: string | null
  maxItems?: number | null
  marker?: string | null
}

export interface IAMSimulatePrincipalPolicyParams extends IAMConnectionConfig {
  policySourceArn: string
  actionNames: string
  resourceArns?: string | null
  maxResults?: number | null
  marker?: string | null
}

export interface IAMListAttachedPoliciesResponse extends ToolResponse {
  output: {
    attachedPolicies: Array<{
      policyName: string
      policyArn: string
    }>
    isTruncated: boolean
    marker: string | null
    count: number
  }
  error?: string
}

export interface IAMSimulatePrincipalPolicyResponse extends ToolResponse {
  output: {
    evaluationResults: Array<{
      evalActionName: string
      evalResourceName: string
      evalDecision: string
      matchedStatements: Array<{ sourcePolicyId: string; sourcePolicyType: string }>
      missingContextValues: string[]
    }>
    isTruncated: boolean
    marker: string | null
    count: number
  }
  error?: string
}
