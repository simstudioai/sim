import { GoogleGroupsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const GoogleGroupsBlock: BlockConfig = {
  type: 'google_groups',
  name: 'Google Groups',
  description: 'Manage Google Workspace Groups and their members',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect to Google Workspace to create, update, and manage groups and their members using the Admin SDK Directory API.',
  docsLink: 'https://developers.google.com/admin-sdk/directory/v1/guides/manage-groups',
  category: 'tools',
  bgColor: '#E8F0FE',
  icon: GoogleGroupsIcon,
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
      required: true,
      serviceId: 'google-groups',
      requiredScopes: [
        'https://www.googleapis.com/auth/admin.directory.group',
        'https://www.googleapis.com/auth/admin.directory.group.member',
      ],
      placeholder: 'Select Google Workspace account',
    },

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
        const { credential, operation, ...rest } = params

        switch (operation) {
          case 'list_groups':
            return {
              credential,
              customer: rest.customer,
              domain: rest.domain,
              query: rest.query,
              maxResults: rest.maxResults ? Number(rest.maxResults) : undefined,
            }
          case 'get_group':
          case 'delete_group':
            return {
              credential,
              groupKey: rest.groupKey,
            }
          case 'create_group':
            return {
              credential,
              email: rest.email,
              name: rest.name,
              description: rest.description,
            }
          case 'update_group':
            return {
              credential,
              groupKey: rest.groupKey,
              name: rest.newName,
              email: rest.newEmail,
              description: rest.description,
            }
          case 'list_members':
            return {
              credential,
              groupKey: rest.groupKey,
              maxResults: rest.maxResults ? Number(rest.maxResults) : undefined,
              roles: rest.roles,
            }
          case 'get_member':
          case 'remove_member':
            return {
              credential,
              groupKey: rest.groupKey,
              memberKey: rest.memberKey,
            }
          case 'add_member':
            return {
              credential,
              groupKey: rest.groupKey,
              email: rest.memberEmail,
              role: rest.role,
            }
          case 'update_member':
            return {
              credential,
              groupKey: rest.groupKey,
              memberKey: rest.memberKey,
              role: rest.role,
            }
          case 'has_member':
            return {
              credential,
              groupKey: rest.groupKey,
              memberKey: rest.memberKey,
            }
          case 'list_aliases':
            return {
              credential,
              groupKey: rest.groupKey,
            }
          case 'add_alias':
            return {
              credential,
              groupKey: rest.groupKey,
              alias: rest.alias,
            }
          case 'remove_alias':
            return {
              credential,
              groupKey: rest.groupKey,
              alias: rest.alias,
            }
          case 'get_settings':
            return {
              credential,
              groupEmail: rest.groupEmail,
            }
          case 'update_settings':
            return {
              credential,
              groupEmail: rest.groupEmail,
            }
          default:
            return { credential, ...rest }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Workspace OAuth credential' },
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
    settings: { type: 'json', description: 'Group settings object (for get/update_settings)' },
    deleted: { type: 'boolean', description: 'Deletion result (for remove_alias)' },
  },
}
