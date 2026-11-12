import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Common parameters for Google Groups API calls
 */
interface GoogleGroupsCommonParams {
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
  userKey?: string
  orderBy?: string
  sortOrder?: string
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
  includeDerivedMembership?: boolean
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
 * Group settings fields returned by the Groups Settings API
 */
interface GoogleGroupsSettings {
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

/**
 * Response for getting group settings
 */
export interface GoogleGroupsGetSettingsResponse extends ToolResponse {
  output: GoogleGroupsSettings & { settings: GoogleGroupsSettings }
}

/**
 * Response for updating group settings
 */
export interface GoogleGroupsUpdateSettingsResponse extends ToolResponse {
  output: GoogleGroupsSettings & { settings: GoogleGroupsSettings }
}

/** Settings fields as the Groups Settings API returns them (`default_sender` is snake_case on the wire). */
type GoogleGroupsSettingsApiData = { [K in keyof GoogleGroupsSettings]?: string | null } & {
  default_sender?: string | null
}

/** Maps a Groups Settings API resource to the flat settings output shared by Get and Update Settings. */
export function mapGroupSettings(data: GoogleGroupsSettingsApiData): GoogleGroupsSettings {
  return {
    email: data.email ?? null,
    name: data.name ?? null,
    description: data.description ?? null,
    whoCanJoin: data.whoCanJoin ?? null,
    whoCanViewMembership: data.whoCanViewMembership ?? null,
    whoCanViewGroup: data.whoCanViewGroup ?? null,
    whoCanPostMessage: data.whoCanPostMessage ?? null,
    allowExternalMembers: data.allowExternalMembers ?? null,
    allowWebPosting: data.allowWebPosting ?? null,
    primaryLanguage: data.primaryLanguage ?? null,
    isArchived: data.isArchived ?? null,
    archiveOnly: data.archiveOnly ?? null,
    messageModerationLevel: data.messageModerationLevel ?? null,
    spamModerationLevel: data.spamModerationLevel ?? null,
    replyTo: data.replyTo ?? null,
    customReplyTo: data.customReplyTo ?? null,
    includeCustomFooter: data.includeCustomFooter ?? null,
    customFooterText: data.customFooterText ?? null,
    sendMessageDenyNotification: data.sendMessageDenyNotification ?? null,
    defaultMessageDenyNotificationText: data.defaultMessageDenyNotificationText ?? null,
    membersCanPostAsTheGroup: data.membersCanPostAsTheGroup ?? null,
    includeInGlobalAddressList: data.includeInGlobalAddressList ?? null,
    whoCanLeaveGroup: data.whoCanLeaveGroup ?? null,
    whoCanContactOwner: data.whoCanContactOwner ?? null,
    favoriteRepliesOnTop: data.favoriteRepliesOnTop ?? null,
    whoCanApproveMembers: data.whoCanApproveMembers ?? null,
    whoCanBanUsers: data.whoCanBanUsers ?? null,
    whoCanModerateMembers: data.whoCanModerateMembers ?? null,
    whoCanModerateContent: data.whoCanModerateContent ?? null,
    whoCanAssistContent: data.whoCanAssistContent ?? null,
    enableCollaborativeInbox: data.enableCollaborativeInbox ?? null,
    whoCanDiscoverGroup: data.whoCanDiscoverGroup ?? null,
    defaultSender: data.default_sender ?? data.defaultSender ?? null,
  }
}

export const SETTINGS_OBJECT_OUTPUT: OutputProperty = {
  type: 'json',
  description:
    'All returned group settings as one object, with the same fields as the top-level outputs (email, name, description, whoCanJoin, whoCanViewMembership, whoCanViewGroup, whoCanPostMessage, allowExternalMembers, ..., defaultSender)',
}
