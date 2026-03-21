import { AzureIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { MicrosoftAdResponse } from '@/tools/microsoft_ad/types'

export const MicrosoftAdBlock: BlockConfig<MicrosoftAdResponse> = {
  type: 'microsoft_ad',
  name: 'Azure AD',
  description: 'Manage users and groups in Azure AD (Microsoft Entra ID)',
  longDescription:
    'Integrate Azure Active Directory into your workflows. List, create, update, and delete users and groups. Manage group memberships programmatically.',
  docsLink: 'https://docs.sim.ai/tools/microsoft_ad',
  category: 'tools',
  integrationType: IntegrationType.Security,
  tags: ['identity', 'microsoft-365'],
  bgColor: '#0078D4',
  icon: AzureIcon,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Create User', id: 'create_user' },
        { label: 'Update User', id: 'update_user' },
        { label: 'Delete User', id: 'delete_user' },
        { label: 'List Groups', id: 'list_groups' },
        { label: 'Get Group', id: 'get_group' },
        { label: 'Create Group', id: 'create_group' },
        { label: 'Update Group', id: 'update_group' },
        { label: 'Delete Group', id: 'delete_group' },
        { label: 'List Group Members', id: 'list_group_members' },
        { label: 'Add Group Member', id: 'add_group_member' },
        { label: 'Remove Group Member', id: 'remove_group_member' },
      ],
      value: () => 'list_users',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      serviceId: 'microsoft-ad',
      requiredScopes: getScopesForService('microsoft-ad'),
      required: true,
    },
    // User ID field (for get, update, delete user)
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'User ID or user principal name (e.g., user@example.com)',
      condition: { field: 'operation', value: ['get_user', 'update_user', 'delete_user'] },
      required: { field: 'operation', value: ['get_user', 'update_user', 'delete_user'] },
    },
    // Create user fields
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'e.g., John Doe',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      required: { field: 'operation', value: 'create_user' },
    },
    {
      id: 'mailNickname',
      title: 'Mail Nickname',
      type: 'short-input',
      placeholder: 'e.g., johndoe',
      condition: { field: 'operation', value: 'create_user' },
      required: { field: 'operation', value: 'create_user' },
    },
    {
      id: 'userPrincipalName',
      title: 'User Principal Name',
      type: 'short-input',
      placeholder: 'e.g., johndoe@example.com',
      condition: { field: 'operation', value: 'create_user' },
      required: { field: 'operation', value: 'create_user' },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Initial password',
      condition: { field: 'operation', value: 'create_user' },
      required: { field: 'operation', value: 'create_user' },
      password: true,
    },
    {
      id: 'accountEnabled',
      title: 'Account Enabled',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_user' },
    },
    {
      id: 'accountEnabledCreate',
      title: 'Account Enabled',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_user' },
    },
    // Update user optional fields
    {
      id: 'givenName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'e.g., John',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'surname',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'e.g., Doe',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'jobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'e.g., Software Engineer',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'department',
      title: 'Department',
      type: 'short-input',
      placeholder: 'e.g., Engineering',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'officeLocation',
      title: 'Office Location',
      type: 'short-input',
      placeholder: 'e.g., Building A, Room 101',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'mobilePhone',
      title: 'Mobile Phone',
      type: 'short-input',
      placeholder: 'e.g., +1-555-555-5555',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    // List users/groups optional filters
    {
      id: 'top',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'e.g., 100 (max 999)',
      condition: {
        field: 'operation',
        value: ['list_users', 'list_groups', 'list_group_members'],
      },
      mode: 'advanced',
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: "e.g., department eq 'Sales'",
      condition: { field: 'operation', value: ['list_users', 'list_groups'] },
      mode: 'advanced',
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search by name or email',
      condition: { field: 'operation', value: ['list_users', 'list_groups'] },
      mode: 'advanced',
    },
    // Group ID field
    {
      id: 'groupId',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Group ID (GUID)',
      condition: {
        field: 'operation',
        value: [
          'get_group',
          'update_group',
          'delete_group',
          'list_group_members',
          'add_group_member',
          'remove_group_member',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_group',
          'update_group',
          'delete_group',
          'list_group_members',
          'add_group_member',
          'remove_group_member',
        ],
      },
    },
    // Create group fields
    {
      id: 'groupDisplayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'e.g., Engineering Team',
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
      required: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'groupMailNickname',
      title: 'Mail Nickname',
      type: 'short-input',
      placeholder: 'e.g., engineering-team',
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
      required: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'groupDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Group description',
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
    },
    {
      id: 'mailEnabled',
      title: 'Mail Enabled',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'securityEnabled',
      title: 'Security Enabled',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'groupTypes',
      title: 'Group Type',
      type: 'dropdown',
      options: [
        { label: 'Security Group', id: '' },
        { label: 'Microsoft 365 Group', id: 'Unified' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_group' },
      mode: 'advanced',
    },
    {
      id: 'visibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Private', id: 'Private' },
        { label: 'Public', id: 'Public' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_group' },
      mode: 'advanced',
    },
    {
      id: 'visibilityCreate',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Private', id: 'Private' },
        { label: 'Public', id: 'Public' },
      ],
      value: () => 'Private',
      condition: { field: 'operation', value: 'create_group' },
      mode: 'advanced',
    },
    // Member ID (for add/remove member)
    {
      id: 'memberId',
      title: 'Member ID',
      type: 'short-input',
      placeholder: 'User ID to add or remove',
      condition: { field: 'operation', value: ['add_group_member', 'remove_group_member'] },
      required: { field: 'operation', value: ['add_group_member', 'remove_group_member'] },
    },
  ],
  tools: {
    access: [
      'microsoft_ad_list_users',
      'microsoft_ad_get_user',
      'microsoft_ad_create_user',
      'microsoft_ad_update_user',
      'microsoft_ad_delete_user',
      'microsoft_ad_list_groups',
      'microsoft_ad_get_group',
      'microsoft_ad_create_group',
      'microsoft_ad_update_group',
      'microsoft_ad_delete_group',
      'microsoft_ad_list_group_members',
      'microsoft_ad_add_group_member',
      'microsoft_ad_remove_group_member',
    ],
    config: {
      tool: (params) => `microsoft_ad_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.top) result.top = Number(params.top)
        if (params.filter) result.filter = params.filter
        if (params.search) result.search = params.search
        if (params.operation === 'update_user') {
          if (params.accountEnabled) result.accountEnabled = params.accountEnabled === 'true'
        } else if (params.operation === 'create_user') {
          if (params.accountEnabledCreate)
            result.accountEnabled = params.accountEnabledCreate === 'true'
        }
        if (params.mailEnabled !== undefined) result.mailEnabled = params.mailEnabled === 'true'
        if (params.securityEnabled !== undefined)
          result.securityEnabled = params.securityEnabled === 'true'
        // Map group-specific fields to tool param names
        if (params.groupDisplayName) result.displayName = params.groupDisplayName
        if (params.groupMailNickname) result.mailNickname = params.groupMailNickname
        if (params.groupDescription) result.description = params.groupDescription
        if (params.groupTypes !== undefined) result.groupTypes = params.groupTypes
        if (params.operation === 'update_group') {
          if (params.visibility) result.visibility = params.visibility
        } else if (params.operation === 'create_group') {
          if (params.visibilityCreate) result.visibility = params.visibilityCreate
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string' },
    userId: { type: 'string' },
    displayName: { type: 'string' },
    mailNickname: { type: 'string' },
    userPrincipalName: { type: 'string' },
    password: { type: 'string' },
    accountEnabled: { type: 'string' },
    accountEnabledCreate: { type: 'string' },
    givenName: { type: 'string' },
    surname: { type: 'string' },
    jobTitle: { type: 'string' },
    department: { type: 'string' },
    officeLocation: { type: 'string' },
    mobilePhone: { type: 'string' },
    top: { type: 'string' },
    filter: { type: 'string' },
    search: { type: 'string' },
    groupId: { type: 'string' },
    groupDisplayName: { type: 'string' },
    groupMailNickname: { type: 'string' },
    groupDescription: { type: 'string' },
    mailEnabled: { type: 'string' },
    securityEnabled: { type: 'string' },
    groupTypes: { type: 'string' },
    visibility: { type: 'string' },
    visibilityCreate: { type: 'string' },
    memberId: { type: 'string' },
  },
  outputs: {
    response: {
      type: 'json',
      description:
        'Azure AD operation response. User operations return id, displayName, userPrincipalName, mail, jobTitle, department. Group operations return id, displayName, description, mailEnabled, securityEnabled, groupTypes. Member operations return id, displayName, mail, odataType.',
    },
  },
}
