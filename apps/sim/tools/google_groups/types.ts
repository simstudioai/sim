import type { ToolResponse } from '@/tools/types'

/**
 * Common parameters for Google Groups API calls
 */
export interface GoogleGroupsCommonParams {
  accessToken: string
}

/**
 * Parameters for listing groups
 */
export interface GoogleGroupsListParams extends GoogleGroupsCommonParams {
  customer?: string
  domain?: string
  maxResults?: number
  pageToken?: string
  query?: string
}

/**
 * Parameters for getting a specific group
 */
export interface GoogleGroupsGetParams extends GoogleGroupsCommonParams {
  groupKey: string
}

/**
 * Parameters for creating a group
 */
export interface GoogleGroupsCreateParams extends GoogleGroupsCommonParams {
  email: string
  name: string
  description?: string
}

/**
 * Parameters for updating a group
 */
export interface GoogleGroupsUpdateParams extends GoogleGroupsCommonParams {
  groupKey: string
  name?: string
  description?: string
  email?: string
}

/**
 * Parameters for deleting a group
 */
export interface GoogleGroupsDeleteParams extends GoogleGroupsCommonParams {
  groupKey: string
}

/**
 * Parameters for listing group members
 */
export interface GoogleGroupsListMembersParams extends GoogleGroupsCommonParams {
  groupKey: string
  maxResults?: number
  pageToken?: string
  roles?: string
}

/**
 * Parameters for getting a specific member
 */
export interface GoogleGroupsGetMemberParams extends GoogleGroupsCommonParams {
  groupKey: string
  memberKey: string
}

/**
 * Parameters for adding a member to a group
 */
export interface GoogleGroupsAddMemberParams extends GoogleGroupsCommonParams {
  groupKey: string
  email: string
  role?: 'MEMBER' | 'MANAGER' | 'OWNER'
}

/**
 * Parameters for removing a member from a group
 */
export interface GoogleGroupsRemoveMemberParams extends GoogleGroupsCommonParams {
  groupKey: string
  memberKey: string
}

/**
 * Parameters for updating a member's role in a group
 */
export interface GoogleGroupsUpdateMemberParams extends GoogleGroupsCommonParams {
  groupKey: string
  memberKey: string
  role: 'MEMBER' | 'MANAGER' | 'OWNER'
}

/**
 * Parameters for checking if a user is a member of a group
 */
export interface GoogleGroupsHasMemberParams extends GoogleGroupsCommonParams {
  groupKey: string
  memberKey: string
}

/**
 * Standard response for Google Groups operations
 */
export interface GoogleGroupsResponse extends ToolResponse {
  output: Record<string, unknown>
}
