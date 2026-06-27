import { GoogleGroupsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { GoogleGroupsBlockDisplay } from '@/blocks/blocks/google_groups.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'

export const GoogleGroupsBlock: BlockConfig = {
  ...GoogleGroupsBlockDisplay,
  authMode: AuthMode.OAuth,
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
