import type { ToolResponse } from '@/tools/types'

export interface IdentityCenterConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface IdentityCenterListInstancesParams extends IdentityCenterConnectionConfig {
  maxResults?: number | null
  nextToken?: string | null
}

export interface IdentityCenterListAccountsParams extends IdentityCenterConnectionConfig {
  maxResults?: number | null
  nextToken?: string | null
}

export interface IdentityCenterListPermissionSetsParams extends IdentityCenterConnectionConfig {
  instanceArn: string
  maxResults?: number | null
  nextToken?: string | null
}

export interface IdentityCenterGetUserParams extends IdentityCenterConnectionConfig {
  identityStoreId: string
  email: string
}

export interface IdentityCenterCreateAccountAssignmentParams
  extends IdentityCenterConnectionConfig {
  instanceArn: string
  accountId: string
  permissionSetArn: string
  principalType: 'USER' | 'GROUP'
  principalId: string
}

export interface IdentityCenterDeleteAccountAssignmentParams
  extends IdentityCenterConnectionConfig {
  instanceArn: string
  accountId: string
  permissionSetArn: string
  principalType: 'USER' | 'GROUP'
  principalId: string
}

export interface IdentityCenterCheckAssignmentStatusParams extends IdentityCenterConnectionConfig {
  instanceArn: string
  requestId: string
}

export interface IdentityCenterListAccountAssignmentsParams extends IdentityCenterConnectionConfig {
  instanceArn: string
  principalId: string
  principalType: 'USER' | 'GROUP'
  maxResults?: number | null
  nextToken?: string | null
}

export interface IdentityCenterListGroupsParams extends IdentityCenterConnectionConfig {
  identityStoreId: string
  maxResults?: number | null
  nextToken?: string | null
}

export interface IdentityCenterGetGroupParams extends IdentityCenterConnectionConfig {
  identityStoreId: string
  displayName: string
}

export interface IdentityCenterDescribeAccountParams extends IdentityCenterConnectionConfig {
  accountId: string
}

export interface IdentityCenterBaseResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface IdentityCenterListInstancesResponse extends ToolResponse {
  output: {
    instances: Array<{
      instanceArn: string
      identityStoreId: string
      name: string | null
      status: string
      statusReason: string | null
      ownerAccountId: string | null
      createdDate: string | null
    }>
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface IdentityCenterListAccountsResponse extends ToolResponse {
  output: {
    accounts: Array<{
      id: string
      arn: string
      name: string
      email: string
      status: string
      joinedTimestamp: string | null
    }>
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface IdentityCenterListPermissionSetsResponse extends ToolResponse {
  output: {
    permissionSets: Array<{
      permissionSetArn: string
      name: string
      description: string | null
      sessionDuration: string | null
      createdDate: string | null
    }>
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface IdentityCenterGetUserResponse extends ToolResponse {
  output: {
    userId: string
    userName: string
    displayName: string | null
    email: string | null
  }
  error?: string
}

export interface IdentityCenterAssignmentStatusResponse extends ToolResponse {
  output: {
    message: string
    status: string
    requestId: string
    accountId: string | null
    permissionSetArn: string | null
    principalType: string | null
    principalId: string | null
    failureReason: string | null
    createdDate: string | null
  }
  error?: string
}

export interface IdentityCenterListAccountAssignmentsResponse extends ToolResponse {
  output: {
    assignments: Array<{
      accountId: string
      permissionSetArn: string
      principalType: string
      principalId: string
    }>
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface IdentityCenterListGroupsResponse extends ToolResponse {
  output: {
    groups: Array<{
      groupId: string
      displayName: string | null
      description: string | null
      externalIds: Array<{ issuer: string; id: string }>
    }>
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface IdentityCenterGetGroupResponse extends ToolResponse {
  output: {
    groupId: string
    displayName: string | null
    description: string | null
  }
  error?: string
}

export interface IdentityCenterDescribeAccountResponse extends ToolResponse {
  output: {
    id: string
    arn: string
    name: string
    email: string
    status: string
    joinedTimestamp: string | null
  }
  error?: string
}
