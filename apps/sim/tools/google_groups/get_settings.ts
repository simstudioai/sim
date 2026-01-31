import type {
  GoogleGroupsGetSettingsParams,
  GoogleGroupsGetSettingsResponse,
} from '@/tools/google_groups/types'
import type { ToolConfig } from '@/tools/types'

export const getSettingsTool: ToolConfig<
  GoogleGroupsGetSettingsParams,
  GoogleGroupsGetSettingsResponse
> = {
  id: 'google_groups_get_settings',
  name: 'Google Groups Get Settings',
  description:
    'Get the settings for a Google Group including access permissions, moderation, and posting options',
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
  },

  request: {
    url: (params) => {
      const encodedEmail = encodeURIComponent(params.groupEmail.trim())
      return `https://www.googleapis.com/groups/v1/groups/${encodedEmail}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get group settings')
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
    name: { type: 'string', description: 'The group name (max 75 characters)' },
    description: { type: 'string', description: 'The group description (max 4096 characters)' },
    whoCanJoin: {
      type: 'string',
      description:
        'Who can join the group (ANYONE_CAN_JOIN, ALL_IN_DOMAIN_CAN_JOIN, INVITED_CAN_JOIN, CAN_REQUEST_TO_JOIN)',
    },
    whoCanViewMembership: { type: 'string', description: 'Who can view group membership' },
    whoCanViewGroup: { type: 'string', description: 'Who can view group messages' },
    whoCanPostMessage: { type: 'string', description: 'Who can post messages to the group' },
    allowExternalMembers: { type: 'string', description: 'Whether external users can be members' },
    allowWebPosting: { type: 'string', description: 'Whether web posting is allowed' },
    primaryLanguage: { type: 'string', description: "The group's primary language" },
    isArchived: { type: 'string', description: 'Whether messages are archived' },
    archiveOnly: { type: 'string', description: 'Whether the group is archive-only (inactive)' },
    messageModerationLevel: { type: 'string', description: 'Message moderation level' },
    spamModerationLevel: {
      type: 'string',
      description: 'Spam handling level (ALLOW, MODERATE, SILENTLY_MODERATE, REJECT)',
    },
    replyTo: { type: 'string', description: 'Default reply destination' },
    customReplyTo: { type: 'string', description: 'Custom email for replies' },
    includeCustomFooter: { type: 'string', description: 'Whether to include custom footer' },
    customFooterText: { type: 'string', description: 'Custom footer text (max 1000 characters)' },
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
    defaultSender: {
      type: 'string',
      description: 'Default sender identity (DEFAULT_SELF or GROUP)',
    },
  },
}
