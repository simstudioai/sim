import type {
  GoogleGroupsUpdateSettingsParams,
  GoogleGroupsUpdateSettingsResponse,
} from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const updateSettingsTool: ToolConfig<
  GoogleGroupsUpdateSettingsParams,
  GoogleGroupsUpdateSettingsResponse
> = {
  id: 'google_groups_update_settings',
  name: 'Google Groups Update Settings',
  description:
    'Update the settings for a Google Group including access permissions, moderation, and posting options',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-groups',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    groupEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The email address of the group (e.g., team@example.com)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The group name (max 75 characters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The group description (max 4096 characters)',
    },
    whoCanJoin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can join: ANYONE_CAN_JOIN, ALL_IN_DOMAIN_CAN_JOIN, INVITED_CAN_JOIN, CAN_REQUEST_TO_JOIN',
    },
    whoCanViewMembership: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can view membership: ALL_IN_DOMAIN_CAN_VIEW, ALL_MEMBERS_CAN_VIEW, ALL_MANAGERS_CAN_VIEW',
    },
    whoCanViewGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can view group messages: ANYONE_CAN_VIEW, ALL_IN_DOMAIN_CAN_VIEW, ALL_MEMBERS_CAN_VIEW, ALL_MANAGERS_CAN_VIEW',
    },
    whoCanPostMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can post: NONE_CAN_POST, ALL_MANAGERS_CAN_POST, ALL_MEMBERS_CAN_POST, ALL_OWNERS_CAN_POST, ALL_IN_DOMAIN_CAN_POST, ANYONE_CAN_POST',
    },
    allowExternalMembers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether external users can be members: true or false',
    },
    allowWebPosting: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether web posting is allowed: true or false',
    },
    primaryLanguage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The group's primary language (e.g., en)",
    },
    isArchived: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether messages are archived: true or false',
    },
    archiveOnly: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the group is archive-only (inactive): true or false',
    },
    messageModerationLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Message moderation: MODERATE_ALL_MESSAGES, MODERATE_NON_MEMBERS, MODERATE_NEW_MEMBERS, MODERATE_NONE',
    },
    spamModerationLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Spam handling: ALLOW, MODERATE, SILENTLY_MODERATE, REJECT',
    },
    replyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Default reply: REPLY_TO_CUSTOM, REPLY_TO_SENDER, REPLY_TO_LIST, REPLY_TO_OWNER, REPLY_TO_IGNORE, REPLY_TO_MANAGERS',
    },
    customReplyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom email for replies (when replyTo is REPLY_TO_CUSTOM)',
    },
    includeCustomFooter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include custom footer: true or false',
    },
    customFooterText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom footer text (max 1000 characters)',
    },
    sendMessageDenyNotification: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send rejection notifications: true or false',
    },
    defaultMessageDenyNotificationText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Default rejection message text',
    },
    membersCanPostAsTheGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether members can post as the group: true or false',
    },
    includeInGlobalAddressList: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether included in Global Address List: true or false',
    },
    whoCanLeaveGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can leave: ALL_MANAGERS_CAN_LEAVE, ALL_MEMBERS_CAN_LEAVE, NONE_CAN_LEAVE',
    },
    whoCanContactOwner: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can contact owner: ALL_IN_DOMAIN_CAN_CONTACT, ALL_MANAGERS_CAN_CONTACT, ALL_MEMBERS_CAN_CONTACT, ANYONE_CAN_CONTACT',
    },
    favoriteRepliesOnTop: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether favorite replies appear at top: true or false',
    },
    whoCanApproveMembers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can approve members: ALL_OWNERS_CAN_APPROVE, ALL_MANAGERS_CAN_APPROVE, ALL_MEMBERS_CAN_APPROVE, NONE_CAN_APPROVE',
    },
    whoCanBanUsers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can ban users: OWNERS_ONLY, OWNERS_AND_MANAGERS, NONE',
    },
    whoCanModerateMembers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can manage members: OWNERS_ONLY, OWNERS_AND_MANAGERS, ALL_MEMBERS, NONE',
    },
    whoCanModerateContent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can moderate content: OWNERS_ONLY, OWNERS_AND_MANAGERS, ALL_MEMBERS, NONE',
    },
    whoCanAssistContent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can assist with content metadata: OWNERS_ONLY, OWNERS_AND_MANAGERS, ALL_MEMBERS, NONE',
    },
    enableCollaborativeInbox: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether collaborative inbox is enabled: true or false',
    },
    whoCanDiscoverGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can discover: ANYONE_CAN_DISCOVER, ALL_IN_DOMAIN_CAN_DISCOVER, ALL_MEMBERS_CAN_DISCOVER',
    },
    defaultSender: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Default sender: DEFAULT_SELF or GROUP',
    },
  },

  request: {
    url: (params) => {
      const encodedEmail = encodeURIComponent(params.groupEmail.trim())
      return `https://www.googleapis.com/groups/v1/groups/${encodedEmail}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.name !== undefined) body.name = params.name
      if (params.description !== undefined) body.description = params.description
      if (params.whoCanJoin !== undefined) body.whoCanJoin = params.whoCanJoin
      if (params.whoCanViewMembership !== undefined)
        body.whoCanViewMembership = params.whoCanViewMembership
      if (params.whoCanViewGroup !== undefined) body.whoCanViewGroup = params.whoCanViewGroup
      if (params.whoCanPostMessage !== undefined) body.whoCanPostMessage = params.whoCanPostMessage
      if (params.allowExternalMembers !== undefined)
        body.allowExternalMembers = params.allowExternalMembers
      if (params.allowWebPosting !== undefined) body.allowWebPosting = params.allowWebPosting
      if (params.primaryLanguage !== undefined) body.primaryLanguage = params.primaryLanguage
      if (params.isArchived !== undefined) body.isArchived = params.isArchived
      if (params.archiveOnly !== undefined) body.archiveOnly = params.archiveOnly
      if (params.messageModerationLevel !== undefined)
        body.messageModerationLevel = params.messageModerationLevel
      if (params.spamModerationLevel !== undefined)
        body.spamModerationLevel = params.spamModerationLevel
      if (params.replyTo !== undefined) body.replyTo = params.replyTo
      if (params.customReplyTo !== undefined) body.customReplyTo = params.customReplyTo
      if (params.includeCustomFooter !== undefined)
        body.includeCustomFooter = params.includeCustomFooter
      if (params.customFooterText !== undefined) body.customFooterText = params.customFooterText
      if (params.sendMessageDenyNotification !== undefined)
        body.sendMessageDenyNotification = params.sendMessageDenyNotification
      if (params.defaultMessageDenyNotificationText !== undefined)
        body.defaultMessageDenyNotificationText = params.defaultMessageDenyNotificationText
      if (params.membersCanPostAsTheGroup !== undefined)
        body.membersCanPostAsTheGroup = params.membersCanPostAsTheGroup
      if (params.includeInGlobalAddressList !== undefined)
        body.includeInGlobalAddressList = params.includeInGlobalAddressList
      if (params.whoCanLeaveGroup !== undefined) body.whoCanLeaveGroup = params.whoCanLeaveGroup
      if (params.whoCanContactOwner !== undefined)
        body.whoCanContactOwner = params.whoCanContactOwner
      if (params.favoriteRepliesOnTop !== undefined)
        body.favoriteRepliesOnTop = params.favoriteRepliesOnTop
      if (params.whoCanApproveMembers !== undefined)
        body.whoCanApproveMembers = params.whoCanApproveMembers
      if (params.whoCanBanUsers !== undefined) body.whoCanBanUsers = params.whoCanBanUsers
      if (params.whoCanModerateMembers !== undefined)
        body.whoCanModerateMembers = params.whoCanModerateMembers
      if (params.whoCanModerateContent !== undefined)
        body.whoCanModerateContent = params.whoCanModerateContent
      if (params.whoCanAssistContent !== undefined)
        body.whoCanAssistContent = params.whoCanAssistContent
      if (params.enableCollaborativeInbox !== undefined)
        body.enableCollaborativeInbox = params.enableCollaborativeInbox
      if (params.whoCanDiscoverGroup !== undefined)
        body.whoCanDiscoverGroup = params.whoCanDiscoverGroup
      if (params.defaultSender !== undefined) body.defaultSender = params.defaultSender
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to update group settings')
    }
    return {
      success: true,
      output: {
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
        defaultSender: data.defaultSender ?? null,
      },
    }
  },

  outputs: {
    email: { type: 'string', description: "The group's email address" },
    name: { type: 'string', description: 'The group name' },
    description: { type: 'string', description: 'The group description' },
    whoCanJoin: { type: 'string', description: 'Who can join the group' },
    whoCanViewMembership: { type: 'string', description: 'Who can view group membership' },
    whoCanViewGroup: { type: 'string', description: 'Who can view group messages' },
    whoCanPostMessage: { type: 'string', description: 'Who can post messages to the group' },
    allowExternalMembers: { type: 'string', description: 'Whether external users can be members' },
    allowWebPosting: { type: 'string', description: 'Whether web posting is allowed' },
    primaryLanguage: { type: 'string', description: "The group's primary language" },
    isArchived: { type: 'string', description: 'Whether messages are archived' },
    archiveOnly: { type: 'string', description: 'Whether the group is archive-only' },
    messageModerationLevel: { type: 'string', description: 'Message moderation level' },
    spamModerationLevel: { type: 'string', description: 'Spam handling level' },
    replyTo: { type: 'string', description: 'Default reply destination' },
    customReplyTo: { type: 'string', description: 'Custom email for replies' },
    includeCustomFooter: { type: 'string', description: 'Whether to include custom footer' },
    customFooterText: { type: 'string', description: 'Custom footer text' },
    sendMessageDenyNotification: {
      type: 'string',
      description: 'Whether to send rejection notifications',
    },
    defaultMessageDenyNotificationText: {
      type: 'string',
      description: 'Default rejection message text',
    },
    membersCanPostAsTheGroup: {
      type: 'string',
      description: 'Whether members can post as the group',
    },
    includeInGlobalAddressList: {
      type: 'string',
      description: 'Whether included in Global Address List',
    },
    whoCanLeaveGroup: { type: 'string', description: 'Who can leave the group' },
    whoCanContactOwner: { type: 'string', description: 'Who can contact the group owner' },
    favoriteRepliesOnTop: { type: 'string', description: 'Whether favorite replies appear at top' },
    whoCanApproveMembers: { type: 'string', description: 'Who can approve new members' },
    whoCanBanUsers: { type: 'string', description: 'Who can ban users' },
    whoCanModerateMembers: { type: 'string', description: 'Who can manage members' },
    whoCanModerateContent: { type: 'string', description: 'Who can moderate content' },
    whoCanAssistContent: { type: 'string', description: 'Who can assist with content metadata' },
    enableCollaborativeInbox: {
      type: 'string',
      description: 'Whether collaborative inbox is enabled',
    },
    whoCanDiscoverGroup: { type: 'string', description: 'Who can discover the group' },
    defaultSender: { type: 'string', description: 'Default sender identity' },
  },
}
