import { ClerkIcon } from '@/components/icons'
import { ClerkBlockDisplay } from '@/blocks/blocks/clerk.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import type { ClerkResponse } from '@/tools/clerk/types'

export const ClerkBlock: BlockConfig<ClerkResponse> = {
  ...ClerkBlockDisplay,
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
      mode: 'advanced',
    },
    {
      id: 'usernameFilter',
      title: 'Username Filter',
      type: 'short-input',
      placeholder: 'Filter by username (comma-separated)',
      condition: { field: 'operation', value: 'clerk_list_users' },
      mode: 'advanced',
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
      mode: 'advanced',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'johndoe',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
      mode: 'advanced',
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
      mode: 'advanced',
    },
    {
      id: 'publicMetadata',
      title: 'Public Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{"role": "admin"}',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
      mode: 'advanced',
    },
    {
      id: 'privateMetadata',
      title: 'Private Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{"internalId": "123"}',
      condition: { field: 'operation', value: ['clerk_create_user', 'clerk_update_user'] },
      mode: 'advanced',
    },
    // Organization params
    {
      id: 'orgQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search by name, ID, or slug',
      condition: { field: 'operation', value: 'clerk_list_organizations' },
      mode: 'advanced',
    },
    {
      id: 'includeMembersCount',
      title: 'Include Members Count',
      type: 'switch',
      condition: { field: 'operation', value: 'clerk_list_organizations' },
      mode: 'advanced',
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
      mode: 'advanced',
    },
    {
      id: 'maxAllowedMemberships',
      title: 'Max Members',
      type: 'short-input',
      placeholder: '0 for unlimited',
      condition: { field: 'operation', value: 'clerk_create_organization' },
      mode: 'advanced',
    },
    // Session params
    {
      id: 'sessionUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'user_...',
      condition: { field: 'operation', value: 'clerk_list_sessions' },
      mode: 'advanced',
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'client_...',
      condition: { field: 'operation', value: 'clerk_list_sessions' },
      mode: 'advanced',
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
      mode: 'advanced',
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
      mode: 'advanced',
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
      mode: 'advanced',
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

export const ClerkBlockMeta = {
  tags: ['identity', 'automation'],
  url: 'https://clerk.com',
  templates: [
    {
      icon: ClerkIcon,
      title: 'Clerk new-signup pipeline',
      prompt:
        'Build a scheduled workflow that lists recent Clerk users, creates each new signup in HubSpot with the right lifecycle stage, and enrolls them in a Loops onboarding sequence.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['hubspot', 'loops'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk MFA enrollment chaser',
      prompt:
        'Create a scheduled workflow that finds Clerk users without MFA enrolled in 30 days, sends in-app prompts via Loops, and writes enrollment progress to a security dashboard.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk session anomaly watcher',
      prompt:
        'Build a scheduled workflow that lists recent Clerk sessions, flags unusual patterns — impossible travel, repeated login failures — and pings the security Slack channel on real threats.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk org-management automator',
      prompt:
        'Create a workflow that on a new enterprise plan via Stripe creates a Clerk organization, invites the admin, and writes the Clerk org ID back to the Stripe customer.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['stripe'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk inactive-user cleaner',
      prompt:
        'Build a scheduled workflow that finds Clerk users with no sign-ins in 180 days, sends a re-engagement email, and removes accounts after a grace period.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk access-review automator',
      prompt:
        'Create a scheduled quarterly workflow that lists Clerk organizations and their users, requires owner re-attestation, and writes the review trail to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk user roster archiver',
      prompt:
        'Build a scheduled workflow that exports the full Clerk user and organization roster to S3 on a retention schedule, and writes the snapshot manifest to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
  ],
  skills: [
    {
      name: 'find-user',
      description:
        'Look up a Clerk user by email, username, or name and return their profile. Use to resolve a user before acting on their account or syncing them elsewhere.',
      content:
        '# Find User\n\nLocate a Clerk user account.\n\n## Steps\n1. Use List Users with a Search Query (matches email, phone, username, or name), or the email/username filters for an exact match.\n2. If you already have the Clerk user id (user_...), use Get User instead for the full record.\n3. Review the returned profile: id, primary email, name, externalId, and flags like banned, locked, and twoFactorEnabled.\n\n## Output\nReturn the matched user id, primary email, name, and key status flags. If multiple users match, list the candidates with their emails so the right one can be confirmed; if none match, say so.',
    },
    {
      name: 'provision-user',
      description:
        'Create or update a Clerk user with email, name, and metadata. Use to onboard a user or sync profile changes from another system into Clerk.',
      content:
        '# Provision User\n\nCreate or update a Clerk user.\n\n## Steps\n1. To create, use Create User with at least an email address (and optionally phone, username, password, first/last name).\n2. To set application roles or app data, pass Public Metadata (visible to the frontend) and Private Metadata (server-only) as JSON.\n3. Set External ID to link the Clerk user to your own system id.\n4. To modify an existing user, use Update User with the user id and only the fields that change.\n\n## Output\nReturn the user id, primary email, and the metadata that was set. Confirm whether the user was created or updated. If a required field is missing or the email already exists, report it clearly.',
    },
    {
      name: 'audit-user-sessions',
      description:
        'List and inspect a Clerk user active sessions and revoke suspicious ones. Use for security review or forced sign-out.',
      content:
        '# Audit User Sessions\n\nReview and control Clerk sessions.\n\n## Steps\n1. Use List Sessions filtered by user id and status (e.g. active) to see current sessions.\n2. For a specific session, use Get Session to read its details: client, status, lastActiveAt.\n3. Identify sessions that look risky (stale, unexpected client, or flagged by your own logic).\n4. Use Revoke Session with the session id to force sign-out of any session that should not continue.\n\n## Output\nReturn the list of sessions reviewed with status and last-active time, and the ids of any sessions revoked. Summarize the action taken so the security trail is clear.',
    },
    {
      name: 'manage-organization',
      description:
        'Create a Clerk organization or look up its details and membership. Use when provisioning a new team or tenant in a multi-tenant app.',
      content:
        '# Manage Organization\n\nCreate or inspect a Clerk organization.\n\n## Steps\n1. To create, use Create Organization with the organization name and the Creator User ID (that user becomes the admin); optionally set a slug and max members.\n2. To inspect, use Get Organization by org id or slug, or List Organizations with a search query and include members count.\n3. Read back the org id, slug, members count, and limits.\n\n## Output\nReturn the organization id, name, slug, and member count. When creating, confirm the admin user and echo the org id so it can be linked back to your billing or CRM record.',
    },
  ],
} as const satisfies BlockMeta
