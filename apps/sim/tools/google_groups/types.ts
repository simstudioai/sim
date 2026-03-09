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
 * Parameters for listing group aliases
 */
export interface GoogleGroupsListAliasesParams extends GoogleGroupsCommonParams {
  groupKey: string
}

/**
 * Parameters for adding a group alias
 */
export interface GoogleGroupsAddAliasParams extends GoogleGroupsCommonParams {
  groupKey: string
  alias: string
}

/**
 * Parameters for removing a group alias
 */
export interface GoogleGroupsRemoveAliasParams extends GoogleGroupsCommonParams {
  groupKey: string
  alias: string
}

/**
 * Parameters for getting group settings
 */
export interface GoogleGroupsGetSettingsParams extends GoogleGroupsCommonParams {
  groupEmail: string
}

/**
 * Parameters for updating group settings
 */
export interface GoogleGroupsUpdateSettingsParams extends GoogleGroupsCommonParams {
  groupEmail: string
  name?: string
  description?: string
  whoCanJoin?: string
  whoCanViewMembership?: string
  whoCanViewGroup?: string
  whoCanPostMessage?: string
  allowExternalMembers?: string
  allowWebPosting?: string
  primaryLanguage?: string
  isArchived?: string
  archiveOnly?: string
  messageModerationLevel?: string
  spamModerationLevel?: string
  replyTo?: string
  customReplyTo?: string
  includeCustomFooter?: string
  customFooterText?: string
  sendMessageDenyNotification?: string
  defaultMessageDenyNotificationText?: string
  membersCanPostAsTheGroup?: string
  includeInGlobalAddressList?: string
  whoCanLeaveGroup?: string
  whoCanContactOwner?: string
  favoriteRepliesOnTop?: string
  whoCanApproveMembers?: string
  whoCanBanUsers?: string
  whoCanModerateMembers?: string
  whoCanModerateContent?: string
  whoCanAssistContent?: string
  enableCollaborativeInbox?: string
  whoCanDiscoverGroup?: string
  defaultSender?: string
}

/**
 * Standard response for Google Groups operations
 */
export interface GoogleGroupsResponse extends ToolResponse {
  output: Record<string, unknown>
}

/**
 * Response for listing group aliases
 */
export interface GoogleGroupsListAliasesResponse extends ToolResponse {
  output: {
    aliases: Array<{
      id?: string
      primaryEmail?: string
      alias?: string
      kind?: string
      etag?: string
    }>
  }
}

/**
 * Response for adding a group alias
 */
export interface GoogleGroupsAddAliasResponse extends ToolResponse {
  output: {
    id: string | null
    primaryEmail: string | null
    alias: string | null
    kind: string | null
    etag: string | null
  }
}

/**
 * Response for removing a group alias
 */
export interface GoogleGroupsRemoveAliasResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/**
 * Response for getting group settings
 */
export interface GoogleGroupsGetSettingsResponse extends ToolResponse {
  output: {
    email: string | null
    name: string | null
    description: string | null
    whoCanJoin: string | null
    whoCanViewMembership: string | null
    whoCanViewGroup: string | null
    whoCanPostMessage: string | null
    allowExternalMembers: string | null
    allowWebPosting: string | null
    primaryLanguage: string | null
    isArchived: string | null
    archiveOnly: string | null
    messageModerationLevel: string | null
    spamModerationLevel: string | null
    replyTo: string | null
    customReplyTo: string | null
    includeCustomFooter: string | null
    customFooterText: string | null
    sendMessageDenyNotification: string | null
    defaultMessageDenyNotificationText: string | null
    membersCanPostAsTheGroup: string | null
    includeInGlobalAddressList: string | null
    whoCanLeaveGroup: string | null
    whoCanContactOwner: string | null
    favoriteRepliesOnTop: string | null
    whoCanApproveMembers: string | null
    whoCanBanUsers: string | null
    whoCanModerateMembers: string | null
    whoCanModerateContent: string | null
    whoCanAssistContent: string | null
    enableCollaborativeInbox: string | null
    whoCanDiscoverGroup: string | null
    defaultSender: string | null
  }
}

/**
 * Response for updating group settings
 */
export interface GoogleGroupsUpdateSettingsResponse extends ToolResponse {
  output: {
    email: string | null
    name: string | null
    description: string | null
    whoCanJoin: string | null
    whoCanViewMembership: string | null
    whoCanViewGroup: string | null
    whoCanPostMessage: string | null
    allowExternalMembers: string | null
    allowWebPosting: string | null
    primaryLanguage: string | null
    isArchived: string | null
    archiveOnly: string | null
    messageModerationLevel: string | null
    spamModerationLevel: string | null
    replyTo: string | null
    customReplyTo: string | null
    includeCustomFooter: string | null
    customFooterText: string | null
    sendMessageDenyNotification: string | null
    defaultMessageDenyNotificationText: string | null
    membersCanPostAsTheGroup: string | null
    includeInGlobalAddressList: string | null
    whoCanLeaveGroup: string | null
    whoCanContactOwner: string | null
    favoriteRepliesOnTop: string | null
    whoCanApproveMembers: string | null
    whoCanBanUsers: string | null
    whoCanModerateMembers: string | null
    whoCanModerateContent: string | null
    whoCanAssistContent: string | null
    enableCollaborativeInbox: string | null
    whoCanDiscoverGroup: string | null
    defaultSender: string | null
  }
}
