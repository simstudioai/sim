import { GoogleGroupsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'

/** Settings the Update Settings operation forwards when set; empty means unchanged. */
const UPDATE_SETTINGS_FIELDS = [
  'whoCanJoin',
  'whoCanViewMembership',
  'whoCanViewGroup',
  'whoCanPostMessage',
  'allowExternalMembers',
  'whoCanDiscoverGroup',
  'whoCanContactOwner',
  'whoCanLeaveGroup',
  'whoCanModerateMembers',
  'whoCanModerateContent',
  'messageModerationLevel',
  'spamModerationLevel',
  'replyTo',
  'allowWebPosting',
  'isArchived',
  'archiveOnly',
  'includeInGlobalAddressList',
  'membersCanPostAsTheGroup',
  'enableCollaborativeInbox',
  'customReplyTo',
  'primaryLanguage',
] as const

export const GoogleGroupsBlock: BlockConfig = {
  type: 'google_groups',
  name: 'Google Groups',
  description: 'Manage Google Workspace Groups and their members',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect to Google Workspace to create, update, and manage groups and their members using the Admin SDK Directory API.',
  docsLink: 'https://docs.sim.ai/integrations/google_groups',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#E8F0FE',
  icon: GoogleGroupsIcon,
  canvasPresentation: {
    defaultTitle: 'Google Groups',
    sentences: {
      byOperation: {
        list_groups: [
          'List groups',
          { text: 'in', field: 'domain' },
          { text: ', matching', field: 'query' },
        ],
        get_group: [{ text: 'Read group', field: 'groupKey', core: true }],
        create_group: [
          { text: 'Create group', field: 'name', core: true },
          { text: 'at', field: 'email' },
        ],
        update_group: [
          { text: 'Update group', field: 'groupKey', core: true },
          { text: ', renaming it to', field: 'newName' },
        ],
        delete_group: [{ text: 'Delete group', field: 'groupKey', core: true }],
        list_members: [
          { text: 'List members of', field: 'groupKey', core: true },
          { text: ', with role', field: 'roles' },
        ],
        get_member: [
          { text: 'Read member', field: 'memberKey', core: true },
          { text: 'of', field: 'groupKey' },
        ],
        add_member: [
          { text: 'Add', field: 'memberEmail', core: true },
          { text: 'to', field: 'groupKey', core: true },
          { text: 'as', field: 'role' },
        ],
        update_member: [
          { text: 'Set role of', field: 'memberKey', core: true },
          { text: 'in', field: 'groupKey', core: true },
          { text: 'to', field: 'role' },
        ],
        remove_member: [
          { text: 'Remove', field: 'memberKey', core: true },
          { text: 'from', field: 'groupKey', core: true },
        ],
        has_member: [
          { text: 'Check whether', field: 'memberKey', core: true },
          { text: 'belongs to', field: 'groupKey', core: true },
        ],
        list_aliases: [{ text: 'List aliases of', field: 'groupKey', core: true }],
        add_alias: [
          { text: 'Add alias', field: 'alias', core: true },
          { text: 'to', field: 'groupKey', core: true },
        ],
        remove_alias: [
          { text: 'Remove alias', field: 'alias', core: true },
          { text: 'from', field: 'groupKey', core: true },
        ],
        get_settings: [{ text: 'Read settings of', field: 'groupEmail', core: true }],
        update_settings: [{ text: 'Update settings of', field: 'groupEmail', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Groups', id: 'list_groups' },
        { label: 'Get Group', id: 'get_group' },
        { label: 'Create Group', id: 'create_group' },
        { label: 'Update Group', id: 'update_group' },
        { label: 'Delete Group', id: 'delete_group' },
        { label: 'List Members', id: 'list_members' },
        { label: 'Get Member', id: 'get_member' },
        { label: 'Add Member', id: 'add_member' },
        { label: 'Update Member Role', id: 'update_member' },
        { label: 'Remove Member', id: 'remove_member' },
        { label: 'Check Membership', id: 'has_member' },
        { label: 'List Aliases', id: 'list_aliases' },
        { label: 'Add Alias', id: 'add_alias' },
        { label: 'Remove Alias', id: 'remove_alias' },
        { label: 'Get Settings', id: 'get_settings' },
        { label: 'Update Settings', id: 'update_settings' },
      ],
      value: () => 'list_groups',
    },
    {
      id: 'credential',
      title: 'Google Groups Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-groups',
      requiredScopes: getScopesForService('google-groups'),
      placeholder: 'Select Google Workspace account',
    },
    {
      id: 'manualCredential',
      title: 'Google Groups Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,

    {
      id: 'customer',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'my_customer (default)',
      condition: { field: 'operation', value: 'list_groups' },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Filter by domain (e.g., example.com)',
      condition: { field: 'operation', value: 'list_groups' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter query (e.g., email:admin*)',
      condition: { field: 'operation', value: 'list_groups' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google Groups search query based on the user's description.
Use Google Groups Admin SDK query syntax:
- email:pattern* - search by email address (supports wildcards)
- name:term - search by group name
- memberKey:email - search by member email

Examples:
- "groups starting with admin" -> email:admin*
- "groups with support in the name" -> name:support*
- "groups containing user@example.com" -> memberKey:user@example.com

Return ONLY the query string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the groups you want to find...',
      },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Maximum results (1-200)',
      condition: {
        field: 'operation',
        value: ['list_groups', 'list_members'],
      },
    },

    {
      id: 'groupKey',
      title: 'Group Email or ID',
      type: 'short-input',
      placeholder: 'group@example.com or group ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'get_group',
          'update_group',
          'delete_group',
          'list_members',
          'get_member',
          'add_member',
          'update_member',
          'remove_member',
          'has_member',
          'list_aliases',
          'add_alias',
          'remove_alias',
        ],
      },
    },

    {
      id: 'groupEmail',
      title: 'Group Email',
      type: 'short-input',
      placeholder: 'group@example.com',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_settings', 'update_settings'],
      },
    },

    {
      id: 'alias',
      title: 'Alias Email',
      type: 'short-input',
      placeholder: 'alias@example.com',
      required: true,
      condition: {
        field: 'operation',
        value: ['add_alias', 'remove_alias'],
      },
    },

    {
      id: 'email',
      title: 'Group Email',
      type: 'short-input',
      placeholder: 'newgroup@example.com',
      required: true,
      condition: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'name',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'Display name for the group',
      required: true,
      condition: { field: 'operation', value: 'create_group' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a professional group display name based on the user's description.
The name should be:
- Clear and descriptive
- Appropriate for a workplace setting
- Concise (typically 2-5 words)

Examples:
- "marketing team" -> Marketing Team
- "project managers" -> Project Managers
- "sales leadership" -> Sales Leadership Team

Return ONLY the group name - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the group you want to create...',
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Optional description for the group',
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a professional group description based on the user's request.
The description should:
- Clearly explain the purpose of the group
- Be concise but informative (1-3 sentences)
- Use professional language appropriate for a workplace setting

Return ONLY the description text - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the purpose of this group...',
      },
    },

    {
      id: 'newName',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'New display name',
      condition: { field: 'operation', value: 'update_group' },
    },
    {
      id: 'newEmail',
      title: 'New Email',
      type: 'short-input',
      placeholder: 'New email address',
      condition: { field: 'operation', value: 'update_group' },
    },

    {
      id: 'memberKey',
      title: 'Member Email or ID',
      type: 'short-input',
      placeholder: 'user@example.com or member ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_member', 'update_member', 'remove_member', 'has_member'],
      },
    },
    {
      id: 'memberEmail',
      title: 'Member Email',
      type: 'short-input',
      placeholder: 'user@example.com',
      required: true,
      condition: { field: 'operation', value: 'add_member' },
    },
    {
      id: 'role',
      title: 'Member Role',
      type: 'dropdown',
      options: [
        { id: 'MEMBER', label: 'Member' },
        { id: 'MANAGER', label: 'Manager' },
        { id: 'OWNER', label: 'Owner' },
      ],
      condition: { field: 'operation', value: ['add_member', 'update_member'] },
    },
    {
      id: 'roles',
      title: 'Filter by Roles',
      type: 'short-input',
      placeholder: 'OWNER,MANAGER,MEMBER',
      condition: { field: 'operation', value: 'list_members' },
    },
    {
      id: 'userKey',
      title: 'Member Email or ID',
      type: 'short-input',
      placeholder: 'Only groups this user belongs to (e.g., user@example.com)',
      condition: { field: 'operation', value: 'list_groups' },
    },
    {
      id: 'sortOrder',
      title: 'Sort by Email',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Ascending', id: 'ASCENDING' },
        { label: 'Descending', id: 'DESCENDING' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_groups' },
      mode: 'advanced',
    },
    {
      id: 'includeDerivedMembership',
      title: 'Include Nested Members',
      type: 'switch',
      condition: { field: 'operation', value: 'list_members' },
      mode: 'advanced',
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token from a previous response',
      condition: { field: 'operation', value: ['list_groups', 'list_members'] },
      mode: 'advanced',
    },
    // Update Settings Fields (empty means unchanged)
    {
      id: 'whoCanJoin',
      title: 'Who Can Join',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Anyone Can Join', id: 'ANYONE_CAN_JOIN' },
        { label: 'All In Domain Can Join', id: 'ALL_IN_DOMAIN_CAN_JOIN' },
        { label: 'Invited Can Join', id: 'INVITED_CAN_JOIN' },
        { label: 'Can Request To Join', id: 'CAN_REQUEST_TO_JOIN' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
    },
    {
      id: 'whoCanViewMembership',
      title: 'Who Can View Members',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'All In Domain Can View', id: 'ALL_IN_DOMAIN_CAN_VIEW' },
        { label: 'All Members Can View', id: 'ALL_MEMBERS_CAN_VIEW' },
        { label: 'All Managers Can View', id: 'ALL_MANAGERS_CAN_VIEW' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
    },
    {
      id: 'whoCanViewGroup',
      title: 'Who Can View Messages',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Anyone Can View', id: 'ANYONE_CAN_VIEW' },
        { label: 'All In Domain Can View', id: 'ALL_IN_DOMAIN_CAN_VIEW' },
        { label: 'All Members Can View', id: 'ALL_MEMBERS_CAN_VIEW' },
        { label: 'All Managers Can View', id: 'ALL_MANAGERS_CAN_VIEW' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
    },
    {
      id: 'whoCanPostMessage',
      title: 'Who Can Post',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'None Can Post', id: 'NONE_CAN_POST' },
        { label: 'All Managers Can Post', id: 'ALL_MANAGERS_CAN_POST' },
        { label: 'All Members Can Post', id: 'ALL_MEMBERS_CAN_POST' },
        { label: 'All Owners Can Post', id: 'ALL_OWNERS_CAN_POST' },
        { label: 'All In Domain Can Post', id: 'ALL_IN_DOMAIN_CAN_POST' },
        { label: 'Anyone Can Post', id: 'ANYONE_CAN_POST' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
    },
    {
      id: 'allowExternalMembers',
      title: 'Allow External Members',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
    },
    {
      id: 'whoCanDiscoverGroup',
      title: 'Who Can Discover',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Anyone Can Discover', id: 'ANYONE_CAN_DISCOVER' },
        { label: 'All In Domain Can Discover', id: 'ALL_IN_DOMAIN_CAN_DISCOVER' },
        { label: 'All Members Can Discover', id: 'ALL_MEMBERS_CAN_DISCOVER' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'whoCanContactOwner',
      title: 'Who Can Contact Owner',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Anyone Can Contact', id: 'ANYONE_CAN_CONTACT' },
        { label: 'All In Domain Can Contact', id: 'ALL_IN_DOMAIN_CAN_CONTACT' },
        { label: 'All Members Can Contact', id: 'ALL_MEMBERS_CAN_CONTACT' },
        { label: 'All Managers Can Contact', id: 'ALL_MANAGERS_CAN_CONTACT' },
        { label: 'All Owners Can Contact', id: 'ALL_OWNERS_CAN_CONTACT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'whoCanLeaveGroup',
      title: 'Who Can Leave',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'All Members Can Leave', id: 'ALL_MEMBERS_CAN_LEAVE' },
        { label: 'All Managers Can Leave', id: 'ALL_MANAGERS_CAN_LEAVE' },
        { label: 'None Can Leave', id: 'NONE_CAN_LEAVE' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'whoCanModerateMembers',
      title: 'Who Can Manage Members',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'All Members', id: 'ALL_MEMBERS' },
        { label: 'Owners And Managers', id: 'OWNERS_AND_MANAGERS' },
        { label: 'Owners Only', id: 'OWNERS_ONLY' },
        { label: 'None', id: 'NONE' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'whoCanModerateContent',
      title: 'Who Can Moderate Content',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'All Members', id: 'ALL_MEMBERS' },
        { label: 'Owners And Managers', id: 'OWNERS_AND_MANAGERS' },
        { label: 'Owners Only', id: 'OWNERS_ONLY' },
        { label: 'None', id: 'NONE' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'messageModerationLevel',
      title: 'Message Moderation',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Moderate All Messages', id: 'MODERATE_ALL_MESSAGES' },
        { label: 'Moderate Non Members', id: 'MODERATE_NON_MEMBERS' },
        { label: 'Moderate New Members', id: 'MODERATE_NEW_MEMBERS' },
        { label: 'Moderate None', id: 'MODERATE_NONE' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'spamModerationLevel',
      title: 'Spam Handling',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Allow', id: 'ALLOW' },
        { label: 'Moderate', id: 'MODERATE' },
        { label: 'Silently Moderate', id: 'SILENTLY_MODERATE' },
        { label: 'Reject', id: 'REJECT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'replyTo',
      title: 'Default Reply To',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Reply To Sender', id: 'REPLY_TO_SENDER' },
        { label: 'Reply To List', id: 'REPLY_TO_LIST' },
        { label: 'Reply To Owner', id: 'REPLY_TO_OWNER' },
        { label: 'Reply To Custom', id: 'REPLY_TO_CUSTOM' },
        { label: 'Reply To Ignore', id: 'REPLY_TO_IGNORE' },
        { label: 'Reply To Managers', id: 'REPLY_TO_MANAGERS' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'allowWebPosting',
      title: 'Allow Web Posting',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'isArchived',
      title: 'Archive Messages',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'archiveOnly',
      title: 'Archive Only (Inactive)',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'includeInGlobalAddressList',
      title: 'Include in Global Address List',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'membersCanPostAsTheGroup',
      title: 'Members Can Post as Group',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'enableCollaborativeInbox',
      title: 'Collaborative Inbox',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'customReplyTo',
      title: 'Custom Reply-To Email',
      type: 'short-input',
      placeholder: 'reply@example.com',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'primaryLanguage',
      title: 'Primary Language',
      type: 'short-input',
      placeholder: 'en-US',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'google_groups_list_groups',
      'google_groups_get_group',
      'google_groups_create_group',
      'google_groups_update_group',
      'google_groups_delete_group',
      'google_groups_list_members',
      'google_groups_get_member',
      'google_groups_add_member',
      'google_groups_remove_member',
      'google_groups_update_member',
      'google_groups_has_member',
      'google_groups_list_aliases',
      'google_groups_add_alias',
      'google_groups_remove_alias',
      'google_groups_get_settings',
      'google_groups_update_settings',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list_groups':
            return 'google_groups_list_groups'
          case 'get_group':
            return 'google_groups_get_group'
          case 'create_group':
            return 'google_groups_create_group'
          case 'update_group':
            return 'google_groups_update_group'
          case 'delete_group':
            return 'google_groups_delete_group'
          case 'list_members':
            return 'google_groups_list_members'
          case 'get_member':
            return 'google_groups_get_member'
          case 'add_member':
            return 'google_groups_add_member'
          case 'update_member':
            return 'google_groups_update_member'
          case 'remove_member':
            return 'google_groups_remove_member'
          case 'has_member':
            return 'google_groups_has_member'
          case 'list_aliases':
            return 'google_groups_list_aliases'
          case 'add_alias':
            return 'google_groups_add_alias'
          case 'remove_alias':
            return 'google_groups_remove_alias'
          case 'get_settings':
            return 'google_groups_get_settings'
          case 'update_settings':
            return 'google_groups_update_settings'
          default:
            throw new Error(`Invalid Google Groups operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, operation, ...rest } = params

        switch (operation) {
          case 'list_groups':
            return {
              oauthCredential,
              customer: rest.customer,
              domain: rest.domain,
              query: rest.query,
              maxResults: rest.maxResults ? Number(rest.maxResults) : undefined,
              pageToken: rest.pageToken || undefined,
              userKey: rest.userKey || undefined,
              orderBy: rest.sortOrder ? 'email' : undefined,
              sortOrder: rest.sortOrder || undefined,
            }
          case 'get_group':
          case 'delete_group':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
            }
          case 'create_group':
            return {
              oauthCredential,
              email: rest.email,
              name: rest.name,
              description: rest.description,
            }
          case 'update_group':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
              name: rest.newName,
              email: rest.newEmail,
              description: rest.description,
            }
          case 'list_members':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
              maxResults: rest.maxResults ? Number(rest.maxResults) : undefined,
              roles: rest.roles,
              pageToken: rest.pageToken || undefined,
              includeDerivedMembership:
                rest.includeDerivedMembership === true || rest.includeDerivedMembership === 'true'
                  ? true
                  : undefined,
            }
          case 'get_member':
          case 'remove_member':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
              memberKey: rest.memberKey,
            }
          case 'add_member':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
              email: rest.memberEmail,
              role: rest.role,
            }
          case 'update_member':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
              memberKey: rest.memberKey,
              role: rest.role,
            }
          case 'has_member':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
              memberKey: rest.memberKey,
            }
          case 'list_aliases':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
            }
          case 'add_alias':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
              alias: rest.alias,
            }
          case 'remove_alias':
            return {
              oauthCredential,
              groupKey: rest.groupKey,
              alias: rest.alias,
            }
          case 'get_settings':
            return {
              oauthCredential,
              groupEmail: rest.groupEmail,
            }
          case 'update_settings':
            return {
              oauthCredential,
              groupEmail: rest.groupEmail,
              ...Object.fromEntries(
                UPDATE_SETTINGS_FIELDS.map((key) => [
                  key,
                  rest[key] === undefined || rest[key] === null || rest[key] === ''
                    ? undefined
                    : String(rest[key]),
                ])
              ),
            }
          default:
            return { oauthCredential, ...rest }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Workspace OAuth credential' },
    customer: { type: 'string', description: 'Customer ID for listing groups' },
    domain: { type: 'string', description: 'Domain filter for listing groups' },
    query: { type: 'string', description: 'Search query for filtering groups' },
    maxResults: { type: 'number', description: 'Maximum results to return' },
    groupKey: { type: 'string', description: 'Group email address or ID' },
    email: { type: 'string', description: 'Email address for new group' },
    name: { type: 'string', description: 'Display name for group' },
    description: { type: 'string', description: 'Group description' },
    newName: { type: 'string', description: 'New display name for update' },
    newEmail: { type: 'string', description: 'New email for update' },
    memberKey: { type: 'string', description: 'Member email or ID' },
    memberEmail: { type: 'string', description: 'Email of member to add' },
    role: { type: 'string', description: 'Member role (MEMBER, MANAGER, OWNER)' },
    roles: { type: 'string', description: 'Filter by roles for list members' },
    alias: { type: 'string', description: 'Alias email address' },
    groupEmail: { type: 'string', description: 'Group email address for settings operations' },
    userKey: { type: 'string', description: 'Only list groups this member belongs to' },
    sortOrder: { type: 'string', description: 'Sort groups by email (ASCENDING or DESCENDING)' },
    includeDerivedMembership: { type: 'boolean', description: 'Include indirect members' },
    pageToken: { type: 'string', description: 'Pagination token' },
    whoCanJoin: { type: 'string', description: 'Group setting whoCanJoin (update_settings)' },
    whoCanViewMembership: {
      type: 'string',
      description: 'Group setting whoCanViewMembership (update_settings)',
    },
    whoCanViewGroup: {
      type: 'string',
      description: 'Group setting whoCanViewGroup (update_settings)',
    },
    whoCanPostMessage: {
      type: 'string',
      description: 'Group setting whoCanPostMessage (update_settings)',
    },
    allowExternalMembers: {
      type: 'string',
      description: 'Group setting allowExternalMembers (update_settings)',
    },
    whoCanDiscoverGroup: {
      type: 'string',
      description: 'Group setting whoCanDiscoverGroup (update_settings)',
    },
    whoCanContactOwner: {
      type: 'string',
      description: 'Group setting whoCanContactOwner (update_settings)',
    },
    whoCanLeaveGroup: {
      type: 'string',
      description: 'Group setting whoCanLeaveGroup (update_settings)',
    },
    whoCanModerateMembers: {
      type: 'string',
      description: 'Group setting whoCanModerateMembers (update_settings)',
    },
    whoCanModerateContent: {
      type: 'string',
      description: 'Group setting whoCanModerateContent (update_settings)',
    },
    messageModerationLevel: {
      type: 'string',
      description: 'Group setting messageModerationLevel (update_settings)',
    },
    spamModerationLevel: {
      type: 'string',
      description: 'Group setting spamModerationLevel (update_settings)',
    },
    replyTo: { type: 'string', description: 'Group setting replyTo (update_settings)' },
    allowWebPosting: {
      type: 'string',
      description: 'Group setting allowWebPosting (update_settings)',
    },
    isArchived: { type: 'string', description: 'Group setting isArchived (update_settings)' },
    archiveOnly: { type: 'string', description: 'Group setting archiveOnly (update_settings)' },
    includeInGlobalAddressList: {
      type: 'string',
      description: 'Group setting includeInGlobalAddressList (update_settings)',
    },
    membersCanPostAsTheGroup: {
      type: 'string',
      description: 'Group setting membersCanPostAsTheGroup (update_settings)',
    },
    enableCollaborativeInbox: {
      type: 'string',
      description: 'Group setting enableCollaborativeInbox (update_settings)',
    },
    customReplyTo: { type: 'string', description: 'Group setting customReplyTo (update_settings)' },
    primaryLanguage: {
      type: 'string',
      description: 'Group setting primaryLanguage (update_settings)',
    },
  },
  outputs: {
    groups: { type: 'json', description: 'Array of group objects (for list_groups)' },
    group: { type: 'json', description: 'Single group object (for get/create/update_group)' },
    members: { type: 'json', description: 'Array of member objects (for list_members)' },
    member: { type: 'json', description: 'Single member object (for get/add/update_member)' },
    isMember: { type: 'boolean', description: 'Membership check result (for has_member)' },
    message: { type: 'string', description: 'Success message (for delete/remove operations)' },
    nextPageToken: { type: 'string', description: 'Token for fetching next page of results' },
    aliases: { type: 'json', description: 'Array of alias objects (for list_aliases)' },
    settings: {
      type: 'json',
      description:
        'Group settings object for get/update_settings (email, name, description, whoCanJoin, whoCanViewMembership, whoCanViewGroup, whoCanPostMessage, allowExternalMembers, messageModerationLevel, replyTo, ..., defaultSender)',
    },
    deleted: { type: 'boolean', description: 'Deletion result (for remove_alias)' },
  },
}

export const GoogleGroupsBlockMeta = {
  tags: ['google-workspace', 'messaging', 'identity'],
  url: 'https://groups.google.com',
  templates: [
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups onboarding sync',
      prompt:
        'Create a workflow that watches Rippling or Greenhouse for new hires, adds them to the right Google Groups based on team and department, and emails the new hire a list of the groups joined.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['rippling', 'greenhouse'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups quarterly access review',
      prompt:
        'Build a scheduled workflow that runs each quarter, lists every Google Group with members and owners, writes the report to a table for compliance review, and pings owners to confirm membership in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups departure cleanup',
      prompt:
        'Create a workflow that watches Workday or Rippling for terminations and removes the departing user from every Google Group they belonged to, writing the change to a security audit log.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday', 'rippling'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups self-serve requester',
      prompt:
        'Build a workflow that accepts a Google Group access request via a form, gets manager approval over Slack, adds the user to the group, and notifies the requester when access is granted.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups distribution-list audit',
      prompt:
        'Create a scheduled workflow that scans Google Groups marked as distribution lists, flags external members against an allowlist, and posts a Slack report to the security team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups empty-group cleanup',
      prompt:
        'Build a scheduled workflow that lists Google Groups with no members, opens a confirmation thread with the owner in Slack, and deletes the group once approved.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups settings hardening',
      prompt:
        'Create a scheduled workflow that reads the settings for every Google Group, flags groups that allow external posting or open membership against policy, and posts the findings to the security team in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'add-member-to-group',
      description:
        'Add a user to a Google Workspace group with a chosen role and confirm membership.',
      content:
        '# Add a Member to a Group\n\nGrant someone membership in a Workspace group.\n\n## Steps\n1. Identify the group email or ID and the member email.\n2. Run Check Membership first to see if the user is already a member; skip the add if so.\n3. Run Add Member with the member email and the desired role (MEMBER, MANAGER, or OWNER; default MEMBER).\n4. Optionally run Check Membership again to confirm the add succeeded.\n\n## Output\nConfirm the user was added (or already present), the role granted, and the group. Note if the operation requires admin privileges that were missing.',
    },
    {
      name: 'audit-group-membership',
      description: 'List the members and roles of a Google Group for access review or compliance.',
      content:
        '# Audit Group Membership\n\nProduce a membership roster for a group.\n\n## Steps\n1. Identify the group email or ID.\n2. Run List Members with a Max Results value; optionally filter by roles (OWNER, MANAGER, MEMBER).\n3. Page through results using the next page token until all members are collected.\n4. Separate owners/managers from regular members and flag any external-domain addresses.\n\n## Output\nA roster grouped by role: owners, managers, members. Include total counts and a list of any external members for review.',
    },
    {
      name: 'create-group',
      description: 'Create a new Google Workspace group with an email, name, and description.',
      content:
        '# Create a Group\n\nStand up a new Workspace group.\n\n## Steps\n1. Decide the group email address, display name, and a clear description of its purpose.\n2. Run List Groups (filter by the intended email/name) to confirm it does not already exist.\n3. Run Create Group with the email, name, and description.\n4. Optionally run Add Member to seed initial owners/managers.\n\n## Output\nConfirm the created group with its email, name, and description. List any initial members added. Note that this requires Workspace admin access.',
    },
    {
      name: 'remove-member-from-group',
      description: 'Remove a user from a Google Group, useful for offboarding and access cleanup.',
      content:
        "# Remove a Member from a Group\n\nRevoke a user's group membership.\n\n## Steps\n1. Identify the group email/ID and the member email or ID.\n2. Run Check Membership to confirm the user is actually a member.\n3. If present, run Remove Member with the group and member keys.\n4. For offboarding across many groups, run List Groups filtered by `memberKey:<email>` first to find every group the user belongs to, then remove from each.\n\n## Output\nConfirm the removal per group, and for offboarding list every group the user was removed from. Note any failures for manual follow-up.",
    },
  ],
} as const satisfies BlockMeta
