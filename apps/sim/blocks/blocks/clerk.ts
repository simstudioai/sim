import { ClerkIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ClerkResponse } from '@/tools/clerk/types'

export const ClerkBlock: BlockConfig<ClerkResponse> = {
  type: 'clerk',
  name: 'Clerk',
  description: 'Manage users, organizations, and sessions in Clerk',
  longDescription:
    'Integrate Clerk authentication and user management into your workflow. Create, update, delete, and list users. Manage organizations and their memberships. Monitor and control user sessions.',
  docsLink: 'https://docs.sim.ai/tools/clerk',
  category: 'tools',
  bgColor: '#131316',
  icon: ClerkIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Users', id: 'clerk_list_users' },
        { label: 'Get User', id: 'clerk_get_user' },
        { label: 'Create User', id: 'clerk_create_user' },
        { label: 'Update User', id: 'clerk_update_user' },
        { label: 'Delete User', id: 'clerk_delete_user' },
        { label: 'List Organizations', id: 'clerk_list_organizations' },
        { label: 'Get Organization', id: 'clerk_get_organization' },
        { label: 'Create Organization', id: 'clerk_create_organization' },
        { label: 'List Sessions', id: 'clerk_list_sessions' },
        { label: 'Get Session', id: 'clerk_get_session' },
        { label: 'Revoke Session', id: 'clerk_revoke_session' },
      ],
      value: () => 'clerk_list_users',
    },
    {
      id: 'secretKey',
      title: 'Secret Key',
      type: 'short-input',
      password: true,
      placeholder: 'sk_live_... or sk_test_...',
      required: true,
    },
    // List Users params
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search by email, phone, username, or name',
      condition: { field: 'operation', value: 'clerk_list_users' },
    },
    {
      id: 'emailAddressFilter',
      title: 'Email Filter',
      type: 'short-input',
      placeholder: 'Filter by email (comma-separated)',
      condition: { field: 'operation', value: 'clerk_list_users' },
    },
    {
      id: 'usernameFilter',
      title: 'Username Filter',
      type: 'short-input',
      placeholder: 'Filter by username (comma-separated)',
      condition: { field: 'operation', value: 'clerk_list_users' },
    },
    // Get User params
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'user_...',
      condition: {
        field: 'operation',
        value: ['clerk_get_user', 'clerk_update_user', 'clerk_delete_user'],
      },
      required: {
        field: 'operation',
        value: ['clerk_get_user', 'clerk_update_user', 'clerk_delete_user'],
      },
    },
    // Create/Update User params
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'user@example.com (comma-separated for multiple)',
      condition: { field: 'operation', value: 'clerk_create_user' },
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+1234567890 (comma-separated for multiple)',
      condition: { field: 'operation', value: 'clerk_create_user' },
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'johndoe',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Minimum 8 characters',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Your system user ID',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
    },
    {
      id: 'publicMetadata',
      title: 'Public Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{"role": "admin"}',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
    },
    {
      id: 'privateMetadata',
      title: 'Private Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{"internalId": "123"}',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
    },
    // Organization params
    {
      id: 'orgQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search by name, ID, or slug',
      condition: { field: 'operation', value: 'clerk_list_organizations' },
    },
    {
      id: 'includeMembersCount',
      title: 'Include Members Count',
      type: 'switch',
      condition: { field: 'operation', value: 'clerk_list_organizations' },
    },
    {
      id: 'organizationId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'org_... or slug',
      condition: { field: 'operation', value: 'clerk_get_organization' },
      required: { field: 'operation', value: 'clerk_get_organization' },
    },
    {
      id: 'orgName',
      title: 'Organization Name',
      type: 'short-input',
      placeholder: 'Acme Corp',
      condition: { field: 'operation', value: 'clerk_create_organization' },
      required: { field: 'operation', value: 'clerk_create_organization' },
    },
    {
      id: 'createdBy',
      title: 'Creator User ID',
      type: 'short-input',
      placeholder: 'user_... (will become admin)',
      condition: { field: 'operation', value: 'clerk_create_organization' },
      required: { field: 'operation', value: 'clerk_create_organization' },
    },
    {
      id: 'slug',
      title: 'Slug',
      type: 'short-input',
      placeholder: 'acme-corp',
      condition: { field: 'operation', value: 'clerk_create_organization' },
    },
    {
      id: 'maxAllowedMemberships',
      title: 'Max Members',
      type: 'short-input',
      placeholder: '0 for unlimited',
      condition: { field: 'operation', value: 'clerk_create_organization' },
    },
    // Session params
    {
      id: 'sessionUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'user_...',
      condition: { field: 'operation', value: 'clerk_list_sessions' },
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'client_...',
      condition: { field: 'operation', value: 'clerk_list_sessions' },
    },
    {
      id: 'sessionStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Active', id: 'active' },
        { label: 'Ended', id: 'ended' },
        { label: 'Expired', id: 'expired' },
        { label: 'Revoked', id: 'revoked' },
        { label: 'Abandoned', id: 'abandoned' },
        { label: 'Pending', id: 'pending' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'clerk_list_sessions' },
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'sess_...',
      condition: { field: 'operation', value: ['clerk_get_session', 'clerk_revoke_session'] },
      required: { field: 'operation', value: ['clerk_get_session', 'clerk_revoke_session'] },
    },
    // Pagination params (common)
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Results per page (1-500, default: 10)',
      condition: {
        field: 'operation',
        value: ['clerk_list_users', 'clerk_list_organizations', 'clerk_list_sessions'],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Skip N results for pagination',
      condition: {
        field: 'operation',
        value: ['clerk_list_users', 'clerk_list_organizations', 'clerk_list_sessions'],
      },
    },
  ],

  tools: {
    access: [
      'clerk_list_users',
      'clerk_get_user',
      'clerk_create_user',
      'clerk_update_user',
      'clerk_delete_user',
      'clerk_list_organizations',
      'clerk_get_organization',
      'clerk_create_organization',
      'clerk_list_sessions',
      'clerk_get_session',
      'clerk_revoke_session',
    ],
    config: {
      tool: (params) => params.operation as string,
      params: (params) => {
        const {
          operation,
          secretKey,
          emailAddressFilter,
          usernameFilter,
          orgQuery,
          orgName,
          sessionUserId,
          sessionStatus,
          publicMetadata,
          privateMetadata,
          maxAllowedMemberships,
          ...rest
        } = params

        const cleanParams: Record<string, unknown> = {
          secretKey,
        }

        // Map UI fields to API params based on operation
        switch (operation) {
          case 'clerk_list_users':
            if (emailAddressFilter) cleanParams.emailAddress = emailAddressFilter
            if (usernameFilter) cleanParams.username = usernameFilter
            break
          case 'clerk_create_user':
          case 'clerk_update_user':
            if (publicMetadata) {
              cleanParams.publicMetadata =
                typeof publicMetadata === 'string' ? JSON.parse(publicMetadata) : publicMetadata
            }
            if (privateMetadata) {
              cleanParams.privateMetadata =
                typeof privateMetadata === 'string' ? JSON.parse(privateMetadata) : privateMetadata
            }
            break
          case 'clerk_list_organizations':
            if (orgQuery) cleanParams.query = orgQuery
            break
          case 'clerk_create_organization':
            if (orgName) cleanParams.name = orgName
            if (maxAllowedMemberships)
              cleanParams.maxAllowedMemberships = Number(maxAllowedMemberships)
            break
          case 'clerk_list_sessions':
            if (sessionUserId) cleanParams.userId = sessionUserId
            if (sessionStatus) cleanParams.status = sessionStatus
            break
        }

        // Add remaining params that don't need mapping
        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value
          }
        })

        return cleanParams
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    secretKey: { type: 'string', description: 'Clerk Secret Key' },
    userId: { type: 'string', description: 'User ID' },
    organizationId: { type: 'string', description: 'Organization ID or slug' },
    sessionId: { type: 'string', description: 'Session ID' },
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Results per page' },
    offset: { type: 'number', description: 'Pagination offset' },
  },

  outputs: {
    // List outputs (arrays stored as json for block compatibility)
    users: { type: 'json', description: 'Array of user objects' },
    organizations: { type: 'json', description: 'Array of organization objects' },
    sessions: { type: 'json', description: 'Array of session objects' },
    // Single entity fields (destructured from get/create/update operations)
    id: { type: 'string', description: 'Resource ID (user, organization, or session)' },
    name: { type: 'string', description: 'Organization name' },
    slug: { type: 'string', description: 'Organization slug' },
    username: { type: 'string', description: 'Username' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    imageUrl: { type: 'string', description: 'Profile image URL' },
    hasImage: { type: 'boolean', description: 'Whether resource has an image' },
    emailAddresses: { type: 'json', description: 'User email addresses' },
    phoneNumbers: { type: 'json', description: 'User phone numbers' },
    primaryEmailAddressId: { type: 'string', description: 'Primary email address ID' },
    primaryPhoneNumberId: { type: 'string', description: 'Primary phone number ID' },
    externalId: { type: 'string', description: 'External system ID' },
    passwordEnabled: { type: 'boolean', description: 'Whether password is enabled' },
    twoFactorEnabled: { type: 'boolean', description: 'Whether 2FA is enabled' },
    banned: { type: 'boolean', description: 'Whether user is banned' },
    locked: { type: 'boolean', description: 'Whether user is locked' },
    userId: { type: 'string', description: 'User ID (for sessions)' },
    clientId: { type: 'string', description: 'Client ID (for sessions)' },
    status: { type: 'string', description: 'Session status' },
    lastActiveAt: { type: 'number', description: 'Last activity timestamp' },
    lastSignInAt: { type: 'number', description: 'Last sign-in timestamp' },
    membersCount: { type: 'number', description: 'Number of members' },
    maxAllowedMemberships: { type: 'number', description: 'Max allowed memberships' },
    adminDeleteEnabled: { type: 'boolean', description: 'Whether admin delete is enabled' },
    createdBy: { type: 'string', description: 'Creator user ID' },
    publicMetadata: { type: 'json', description: 'Public metadata' },
    // Common outputs
    totalCount: { type: 'number', description: 'Total count for paginated results' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    object: { type: 'string', description: 'Object type' },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
