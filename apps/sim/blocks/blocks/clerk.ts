import { ClerkIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { ClerkResponse } from '@/tools/clerk/types'
import { getTrigger } from '@/triggers'

export const ClerkBlock: BlockConfig<ClerkResponse> = {
  type: 'clerk',
  name: 'Clerk',
  description: 'Manage users, organizations, and sessions in Clerk',
  longDescription:
    'Integrate Clerk authentication and user management into your workflow. Create, update, delete, ban, lock, and list users. Manage organizations, their memberships, and invitations. Monitor and control user sessions. Maintain allowlist/blocklist identifiers, JWT templates, and actor tokens.',
  docsLink: 'https://docs.sim.ai/integrations/clerk',
  category: 'tools',
  integrationType: IntegrationType.Security,
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
        { label: 'Ban User', id: 'clerk_ban_user' },
        { label: 'Unban User', id: 'clerk_unban_user' },
        { label: 'Lock User', id: 'clerk_lock_user' },
        { label: 'Unlock User', id: 'clerk_unlock_user' },
        { label: 'Get User OAuth Token', id: 'clerk_get_user_oauth_token' },
        { label: 'List Organizations', id: 'clerk_list_organizations' },
        { label: 'Get Organization', id: 'clerk_get_organization' },
        { label: 'Create Organization', id: 'clerk_create_organization' },
        { label: 'Update Organization', id: 'clerk_update_organization' },
        { label: 'Delete Organization', id: 'clerk_delete_organization' },
        { label: 'List Organization Memberships', id: 'clerk_list_organization_memberships' },
        { label: 'Add Organization Member', id: 'clerk_add_organization_member' },
        { label: 'Update Organization Membership', id: 'clerk_update_organization_membership' },
        { label: 'Remove Organization Member', id: 'clerk_remove_organization_member' },
        { label: 'Create Organization Invitation', id: 'clerk_create_organization_invitation' },
        { label: 'List Organization Invitations', id: 'clerk_list_organization_invitations' },
        { label: 'List Sessions', id: 'clerk_list_sessions' },
        { label: 'Get Session', id: 'clerk_get_session' },
        { label: 'Revoke Session', id: 'clerk_revoke_session' },
        { label: 'List Allowlist Identifiers', id: 'clerk_list_allowlist_identifiers' },
        { label: 'Create Allowlist Identifier', id: 'clerk_create_allowlist_identifier' },
        { label: 'Delete Allowlist Identifier', id: 'clerk_delete_allowlist_identifier' },
        { label: 'List Blocklist Identifiers', id: 'clerk_list_blocklist_identifiers' },
        { label: 'Create Blocklist Identifier', id: 'clerk_create_blocklist_identifier' },
        { label: 'Delete Blocklist Identifier', id: 'clerk_delete_blocklist_identifier' },
        { label: 'List JWT Templates', id: 'clerk_list_jwt_templates' },
        { label: 'Get JWT Template', id: 'clerk_get_jwt_template' },
        { label: 'Create Actor Token', id: 'clerk_create_actor_token' },
        { label: 'Revoke Actor Token', id: 'clerk_revoke_actor_token' },
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
    {
      id: 'phoneNumberFilter',
      title: 'Phone Filter',
      type: 'short-input',
      placeholder: 'Filter by phone number (comma-separated)',
      condition: { field: 'operation', value: 'clerk_list_users' },
      mode: 'advanced',
    },
    {
      id: 'externalIdFilter',
      title: 'External ID Filter',
      type: 'short-input',
      placeholder: 'Filter by external ID (comma-separated)',
      condition: { field: 'operation', value: 'clerk_list_users' },
      mode: 'advanced',
    },
    {
      id: 'userIdFilter',
      title: 'User ID Filter',
      type: 'short-input',
      placeholder: 'Filter by user ID (comma-separated)',
      condition: { field: 'operation', value: 'clerk_list_users' },
      mode: 'advanced',
    },
    {
      id: 'orderBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'e.g. -created_at',
      condition: {
        field: 'operation',
        value: [
          'clerk_list_users',
          'clerk_list_organizations',
          'clerk_list_organization_memberships',
          'clerk_list_organization_invitations',
        ],
      },
      mode: 'advanced',
    },
    // Get/Update/Delete/Ban/Unban/Lock/Unlock User, OAuth token, and Actor Token params
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'user_...',
      condition: {
        field: 'operation',
        value: [
          'clerk_get_user',
          'clerk_update_user',
          'clerk_delete_user',
          'clerk_ban_user',
          'clerk_unban_user',
          'clerk_lock_user',
          'clerk_unlock_user',
          'clerk_get_user_oauth_token',
          'clerk_add_organization_member',
          'clerk_update_organization_membership',
          'clerk_remove_organization_member',
          'clerk_create_actor_token',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'clerk_get_user',
          'clerk_update_user',
          'clerk_delete_user',
          'clerk_ban_user',
          'clerk_unban_user',
          'clerk_lock_user',
          'clerk_unlock_user',
          'clerk_get_user_oauth_token',
          'clerk_add_organization_member',
          'clerk_update_organization_membership',
          'clerk_remove_organization_member',
          'clerk_create_actor_token',
        ],
      },
    },
    {
      id: 'provider',
      title: 'OAuth Provider',
      type: 'short-input',
      placeholder: 'google, github, microsoft...',
      condition: { field: 'operation', value: 'clerk_get_user_oauth_token' },
      required: { field: 'operation', value: 'clerk_get_user_oauth_token' },
    },
    // Create/Update User params
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'user@example.com (comma-separated for multiple)',
      condition: {
        field: 'operation',
        value: ['clerk_create_user', 'clerk_create_organization_invitation'],
      },
      required: { field: 'operation', value: 'clerk_create_organization_invitation' },
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
      condition: {
        field: 'operation',
        value: [
          'clerk_create_user',
          'clerk_update_user',
          'clerk_create_organization',
          'clerk_create_organization_invitation',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'privateMetadata',
      title: 'Private Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{"internalId": "123"}',
      condition: {
        field: 'operation',
        value: [
          'clerk_create_user',
          'clerk_update_user',
          'clerk_create_organization',
          'clerk_create_organization_invitation',
        ],
      },
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
      condition: {
        field: 'operation',
        value: [
          'clerk_get_organization',
          'clerk_update_organization',
          'clerk_delete_organization',
          'clerk_list_organization_memberships',
          'clerk_add_organization_member',
          'clerk_update_organization_membership',
          'clerk_remove_organization_member',
          'clerk_create_organization_invitation',
          'clerk_list_organization_invitations',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'clerk_get_organization',
          'clerk_update_organization',
          'clerk_delete_organization',
          'clerk_list_organization_memberships',
          'clerk_add_organization_member',
          'clerk_update_organization_membership',
          'clerk_remove_organization_member',
          'clerk_create_organization_invitation',
          'clerk_list_organization_invitations',
        ],
      },
    },
    {
      id: 'orgName',
      title: 'Organization Name',
      type: 'short-input',
      placeholder: 'Acme Corp',
      condition: {
        field: 'operation',
        value: ['clerk_create_organization', 'clerk_update_organization'],
      },
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
      condition: {
        field: 'operation',
        value: ['clerk_create_organization', 'clerk_update_organization'],
      },
      mode: 'advanced',
    },
    {
      id: 'maxAllowedMemberships',
      title: 'Max Members',
      type: 'short-input',
      placeholder: '0 for unlimited',
      condition: {
        field: 'operation',
        value: ['clerk_create_organization', 'clerk_update_organization'],
      },
      mode: 'advanced',
    },
    {
      id: 'adminDeleteEnabled',
      title: 'Admin Delete Enabled',
      type: 'switch',
      condition: { field: 'operation', value: 'clerk_update_organization' },
      mode: 'advanced',
    },
    // Organization Membership / Invitation params
    {
      id: 'role',
      title: 'Role',
      type: 'short-input',
      placeholder: 'org:admin or org:member',
      condition: {
        field: 'operation',
        value: [
          'clerk_add_organization_member',
          'clerk_update_organization_membership',
          'clerk_create_organization_invitation',
          'clerk_list_organization_memberships',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'clerk_add_organization_member',
          'clerk_update_organization_membership',
          'clerk_create_organization_invitation',
        ],
      },
    },
    {
      id: 'inviterUserId',
      title: 'Inviter User ID',
      type: 'short-input',
      placeholder: 'user_... (who sent the invite)',
      condition: { field: 'operation', value: 'clerk_create_organization_invitation' },
      mode: 'advanced',
    },
    {
      id: 'redirectUrl',
      title: 'Redirect URL',
      type: 'short-input',
      placeholder: 'https://yourapp.com/accept-invite',
      condition: { field: 'operation', value: 'clerk_create_organization_invitation' },
      mode: 'advanced',
    },
    {
      id: 'expiresInDays',
      title: 'Expires In (Days)',
      type: 'short-input',
      placeholder: '1-365, default: 30',
      condition: { field: 'operation', value: 'clerk_create_organization_invitation' },
      mode: 'advanced',
    },
    {
      id: 'notifyInvitation',
      title: 'Send Invitation Email',
      type: 'switch',
      condition: { field: 'operation', value: 'clerk_create_organization_invitation' },
      mode: 'advanced',
    },
    {
      id: 'invitationEmailFilter',
      title: 'Email Filter',
      type: 'short-input',
      placeholder: 'Filter by invited email',
      condition: { field: 'operation', value: 'clerk_list_organization_invitations' },
      mode: 'advanced',
    },
    {
      id: 'invitationStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Pending', id: 'pending' },
        { label: 'Accepted', id: 'accepted' },
        { label: 'Revoked', id: 'revoked' },
        { label: 'Expired', id: 'expired' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'clerk_list_organization_invitations' },
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
        { label: 'Removed', id: 'removed' },
        { label: 'Replaced', id: 'replaced' },
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
    // Allowlist / Blocklist params
    {
      id: 'identifier',
      title: 'Identifier',
      type: 'short-input',
      placeholder: 'user@example.com, +1234567890, or a web3 wallet',
      condition: {
        field: 'operation',
        value: ['clerk_create_allowlist_identifier', 'clerk_create_blocklist_identifier'],
      },
      required: {
        field: 'operation',
        value: ['clerk_create_allowlist_identifier', 'clerk_create_blocklist_identifier'],
      },
    },
    {
      id: 'allowlistNotify',
      title: 'Notify Identifier',
      type: 'switch',
      condition: { field: 'operation', value: 'clerk_create_allowlist_identifier' },
      mode: 'advanced',
    },
    {
      id: 'identifierId',
      title: 'Identifier ID',
      type: 'short-input',
      placeholder: 'The ID of the allowlist/blocklist identifier',
      condition: {
        field: 'operation',
        value: ['clerk_delete_allowlist_identifier', 'clerk_delete_blocklist_identifier'],
      },
      required: {
        field: 'operation',
        value: ['clerk_delete_allowlist_identifier', 'clerk_delete_blocklist_identifier'],
      },
    },
    // JWT Template params
    {
      id: 'templateId',
      title: 'Template ID',
      type: 'short-input',
      placeholder: 'The ID of the JWT template',
      condition: { field: 'operation', value: 'clerk_get_jwt_template' },
      required: { field: 'operation', value: 'clerk_get_jwt_template' },
    },
    // Actor Token params
    {
      id: 'actor',
      title: 'Actor',
      type: 'code',
      language: 'json',
      placeholder: '{"sub": "user_support_agent_id"}',
      condition: { field: 'operation', value: 'clerk_create_actor_token' },
      required: { field: 'operation', value: 'clerk_create_actor_token' },
    },
    {
      id: 'expiresInSeconds',
      title: 'Expires In (Seconds)',
      type: 'short-input',
      placeholder: 'Default: 3600',
      condition: { field: 'operation', value: 'clerk_create_actor_token' },
      mode: 'advanced',
    },
    {
      id: 'sessionMaxDurationInSeconds',
      title: 'Session Max Duration (Seconds)',
      type: 'short-input',
      placeholder: 'Default: 1800',
      condition: { field: 'operation', value: 'clerk_create_actor_token' },
      mode: 'advanced',
    },
    {
      id: 'actorTokenId',
      title: 'Actor Token ID',
      type: 'short-input',
      placeholder: 'The ID of the actor token to revoke',
      condition: { field: 'operation', value: 'clerk_revoke_actor_token' },
      required: { field: 'operation', value: 'clerk_revoke_actor_token' },
    },
    // Pagination params (common)
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Results per page (1-500, default: 10)',
      condition: {
        field: 'operation',
        value: [
          'clerk_list_users',
          'clerk_list_organizations',
          'clerk_list_sessions',
          'clerk_list_organization_memberships',
          'clerk_list_organization_invitations',
          'clerk_list_allowlist_identifiers',
        ],
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
        value: [
          'clerk_list_users',
          'clerk_list_organizations',
          'clerk_list_sessions',
          'clerk_list_organization_memberships',
          'clerk_list_organization_invitations',
          'clerk_list_allowlist_identifiers',
        ],
      },
      mode: 'advanced',
    },
    ...getTrigger('clerk_user_created').subBlocks,
    ...getTrigger('clerk_user_updated').subBlocks,
    ...getTrigger('clerk_user_deleted').subBlocks,
    ...getTrigger('clerk_session_created').subBlocks,
    ...getTrigger('clerk_session_ended').subBlocks,
    ...getTrigger('clerk_session_removed').subBlocks,
    ...getTrigger('clerk_session_revoked').subBlocks,
    ...getTrigger('clerk_organization_created').subBlocks,
    ...getTrigger('clerk_organization_updated').subBlocks,
    ...getTrigger('clerk_organization_deleted').subBlocks,
    ...getTrigger('clerk_organization_membership_created').subBlocks,
    ...getTrigger('clerk_organization_membership_updated').subBlocks,
    ...getTrigger('clerk_organization_membership_deleted').subBlocks,
    ...getTrigger('clerk_webhook').subBlocks,
  ],

  triggers: {
    enabled: true,
    available: [
      'clerk_user_created',
      'clerk_user_updated',
      'clerk_user_deleted',
      'clerk_session_created',
      'clerk_session_ended',
      'clerk_session_removed',
      'clerk_session_revoked',
      'clerk_organization_created',
      'clerk_organization_updated',
      'clerk_organization_deleted',
      'clerk_organization_membership_created',
      'clerk_organization_membership_updated',
      'clerk_organization_membership_deleted',
      'clerk_webhook',
    ],
  },

  tools: {
    access: [
      'clerk_list_users',
      'clerk_get_user',
      'clerk_create_user',
      'clerk_update_user',
      'clerk_delete_user',
      'clerk_ban_user',
      'clerk_unban_user',
      'clerk_lock_user',
      'clerk_unlock_user',
      'clerk_get_user_oauth_token',
      'clerk_list_organizations',
      'clerk_get_organization',
      'clerk_create_organization',
      'clerk_update_organization',
      'clerk_delete_organization',
      'clerk_list_organization_memberships',
      'clerk_add_organization_member',
      'clerk_update_organization_membership',
      'clerk_remove_organization_member',
      'clerk_create_organization_invitation',
      'clerk_list_organization_invitations',
      'clerk_list_sessions',
      'clerk_get_session',
      'clerk_revoke_session',
      'clerk_list_allowlist_identifiers',
      'clerk_create_allowlist_identifier',
      'clerk_delete_allowlist_identifier',
      'clerk_list_blocklist_identifiers',
      'clerk_create_blocklist_identifier',
      'clerk_delete_blocklist_identifier',
      'clerk_list_jwt_templates',
      'clerk_get_jwt_template',
      'clerk_create_actor_token',
      'clerk_revoke_actor_token',
    ],
    config: {
      tool: (params) => params.operation as string,
      params: (params) => {
        const {
          operation,
          secretKey,
          emailAddressFilter,
          usernameFilter,
          phoneNumberFilter,
          externalIdFilter,
          userIdFilter,
          orgQuery,
          orgName,
          sessionUserId,
          sessionStatus,
          invitationEmailFilter,
          invitationStatus,
          notifyInvitation,
          allowlistNotify,
          publicMetadata,
          privateMetadata,
          actor,
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
            if (phoneNumberFilter) cleanParams.phoneNumber = phoneNumberFilter
            if (externalIdFilter) cleanParams.externalId = externalIdFilter
            if (userIdFilter) cleanParams.userId = userIdFilter
            break
          case 'clerk_create_user':
          case 'clerk_update_user':
          case 'clerk_create_organization_invitation':
          case 'clerk_create_organization':
            if (publicMetadata) {
              cleanParams.publicMetadata =
                typeof publicMetadata === 'string' ? JSON.parse(publicMetadata) : publicMetadata
            }
            if (privateMetadata) {
              cleanParams.privateMetadata =
                typeof privateMetadata === 'string' ? JSON.parse(privateMetadata) : privateMetadata
            }
            if (
              operation === 'clerk_create_organization_invitation' &&
              notifyInvitation !== undefined
            ) {
              cleanParams.notify = notifyInvitation
            }
            if (operation === 'clerk_create_organization' && orgName) {
              cleanParams.name = orgName
            }
            break
          case 'clerk_list_organizations':
            if (orgQuery) cleanParams.query = orgQuery
            break
          case 'clerk_update_organization':
            if (orgName) cleanParams.name = orgName
            break
          case 'clerk_list_sessions':
            if (sessionUserId) cleanParams.userId = sessionUserId
            if (sessionStatus) cleanParams.status = sessionStatus
            break
          case 'clerk_list_organization_invitations':
            if (invitationEmailFilter) cleanParams.emailAddress = invitationEmailFilter
            if (invitationStatus) cleanParams.status = invitationStatus
            break
          case 'clerk_create_allowlist_identifier':
            if (allowlistNotify !== undefined) cleanParams.notify = allowlistNotify
            break
          case 'clerk_create_actor_token':
            if (actor !== undefined) {
              cleanParams.actor = typeof actor === 'string' ? JSON.parse(actor) : actor
            }
            break
        }

        // Fields that arrive as strings from short-input UI but must be numbers at execution time
        const numericFields = new Set([
          'limit',
          'offset',
          'maxAllowedMemberships',
          'expiresInDays',
          'expiresInSeconds',
          'sessionMaxDurationInSeconds',
        ])

        // Add remaining params that don't need mapping
        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = numericFields.has(key) ? Number(value) : value
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
    role: { type: 'string', description: 'Organization role, e.g. org:admin or org:member' },
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Results per page' },
    offset: { type: 'number', description: 'Pagination offset' },
  },

  outputs: {
    // List outputs (arrays stored as json for block compatibility)
    users: { type: 'json', description: 'Array of user objects' },
    organizations: { type: 'json', description: 'Array of organization objects' },
    sessions: { type: 'json', description: 'Array of session objects' },
    memberships: { type: 'json', description: 'Array of organization membership objects' },
    invitations: { type: 'json', description: 'Array of organization invitation objects' },
    identifiers: { type: 'json', description: 'Array of allowlist/blocklist identifier objects' },
    templates: { type: 'json', description: 'Array of JWT template objects' },
    accessTokens: { type: 'json', description: 'Array of OAuth access token objects' },
    // Single entity fields (destructured from get/create/update operations)
    id: { type: 'string', description: 'Resource ID (user, organization, session, etc.)' },
    name: { type: 'string', description: 'Organization name' },
    slug: { type: 'string', description: 'Organization slug' },
    username: { type: 'string', description: 'Username' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    imageUrl: { type: 'string', description: 'Profile image URL' },
    hasImage: { type: 'boolean', description: 'Whether resource has an image' },
    emailAddresses: { type: 'json', description: 'User email addresses' },
    phoneNumbers: { type: 'json', description: 'User phone numbers' },
    emailAddress: { type: 'string', description: 'Email address (for invitations)' },
    primaryEmailAddressId: { type: 'string', description: 'Primary email address ID' },
    primaryPhoneNumberId: { type: 'string', description: 'Primary phone number ID' },
    primaryWeb3WalletId: { type: 'string', description: 'Primary Web3 wallet ID' },
    externalId: { type: 'string', description: 'External system ID' },
    passwordEnabled: { type: 'boolean', description: 'Whether password is enabled' },
    twoFactorEnabled: { type: 'boolean', description: 'Whether 2FA is enabled' },
    totpEnabled: { type: 'boolean', description: 'Whether TOTP is enabled' },
    backupCodeEnabled: { type: 'boolean', description: 'Whether backup codes are enabled' },
    deleteSelfEnabled: { type: 'boolean', description: 'Whether user can delete themselves' },
    createOrganizationEnabled: {
      type: 'boolean',
      description: 'Whether user can create organizations',
    },
    banned: { type: 'boolean', description: 'Whether user is banned' },
    locked: { type: 'boolean', description: 'Whether user is locked' },
    lockoutExpiresInSeconds: { type: 'number', description: 'Seconds until lockout expires' },
    userId: { type: 'string', description: 'User ID (for sessions and memberships)' },
    clientId: { type: 'string', description: 'Client ID (for sessions)' },
    status: { type: 'string', description: 'Session or invitation status' },
    lastActiveAt: { type: 'number', description: 'Last activity timestamp' },
    lastActiveOrganizationId: {
      type: 'string',
      description: 'Last active organization ID (for sessions)',
    },
    lastSignInAt: { type: 'number', description: 'Last sign-in timestamp' },
    membersCount: { type: 'number', description: 'Number of members' },
    pendingInvitationsCount: { type: 'number', description: 'Number of pending invitations' },
    maxAllowedMemberships: { type: 'number', description: 'Max allowed memberships' },
    adminDeleteEnabled: { type: 'boolean', description: 'Whether admin delete is enabled' },
    createdBy: { type: 'string', description: 'Creator user ID' },
    publicMetadata: { type: 'json', description: 'Public metadata' },
    privateMetadata: { type: 'json', description: 'Private metadata' },
    unsafeMetadata: { type: 'json', description: 'Unsafe metadata' },
    organizationId: {
      type: 'string',
      description: 'Organization ID (for memberships/invitations)',
    },
    role: { type: 'string', description: 'Organization membership role' },
    roleName: { type: 'string', description: 'Human-readable role name' },
    permissions: { type: 'json', description: 'Permissions granted by the role' },
    identifier: { type: 'string', description: 'Allowlist/blocklist identifier value' },
    identifierType: { type: 'string', description: 'Identifier type (email, phone, web3 wallet)' },
    invitationId: { type: 'string', description: 'Allowlist invitation ID' },
    inviterId: { type: 'string', description: 'User ID of the invitation inviter' },
    inviterEmail: { type: 'string', description: "Inviter's email address" },
    inviterFirstName: { type: 'string', description: "Inviter's first name" },
    inviterLastName: { type: 'string', description: "Inviter's last name" },
    expiresAt: { type: 'number', description: 'Expiration timestamp (invitation, actor token)' },
    expireAt: { type: 'number', description: 'Expiration timestamp (session)' },
    abandonAt: { type: 'number', description: 'Session abandon timestamp' },
    url: { type: 'string', description: 'Invitation or actor token URL' },
    token: { type: 'string', description: 'OAuth access token or actor token' },
    provider: { type: 'string', description: 'OAuth provider' },
    scopes: { type: 'json', description: 'OAuth scopes granted to the token' },
    claims: { type: 'json', description: 'JWT template claims' },
    lifetime: { type: 'number', description: 'JWT template lifetime in seconds' },
    allowedClockSkew: { type: 'number', description: 'JWT template allowed clock skew in seconds' },
    customSigningKey: {
      type: 'boolean',
      description: 'Whether the JWT template uses a custom signing key',
    },
    signingAlgorithm: { type: 'string', description: 'JWT template signing algorithm' },
    actor: { type: 'json', description: 'Actor object identifying who is impersonating' },
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
        'Create a workflow that on a new enterprise plan via Stripe creates a Clerk organization, invites the admin by email, and writes the Clerk org ID back to the Stripe customer.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['stripe'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk inactive-user cleaner',
      prompt:
        'Build a scheduled workflow that finds Clerk users with no sign-ins in 180 days, sends a re-engagement email, and bans accounts that stay inactive after a grace period.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk access-review automator',
      prompt:
        'Create a scheduled quarterly workflow that lists Clerk organizations and their memberships, requires owner re-attestation, and writes the review trail to a compliance table.',
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
        '# Find User\n\nLocate a Clerk user account.\n\n## Steps\n1. Use List Users with a Search Query (matches email, phone, username, or name), or the email/username/phone/external ID filters for an exact match.\n2. If you already have the Clerk user id (user_...), use Get User instead for the full record.\n3. Review the returned profile: id, primary email, name, externalId, and flags like banned, locked, and twoFactorEnabled.\n\n## Output\nReturn the matched user id, primary email, name, and key status flags. If multiple users match, list the candidates with their emails so the right one can be confirmed; if none match, say so.',
    },
    {
      name: 'provision-user',
      description:
        'Create or update a Clerk user with email, name, and metadata. Use to onboard a user or sync profile changes from another system into Clerk.',
      content:
        '# Provision User\n\nCreate or update a Clerk user.\n\n## Steps\n1. To create, use Create User with at least an email address (and optionally phone, username, password, first/last name).\n2. To set application roles or app data, pass Public Metadata (visible to the frontend) and Private Metadata (server-only) as JSON.\n3. Set External ID to link the Clerk user to your own system id.\n4. To modify an existing user, use Update User with the user id and only the fields that change.\n\n## Output\nReturn the user id, primary email, and the metadata that was set. Confirm whether the user was created or updated. If a required field is missing or the email already exists, report it clearly.',
    },
    {
      name: 'moderate-user-access',
      description:
        'Ban, unban, lock, or unlock a Clerk user to control their ability to sign in. Use for abuse response, suspicious-activity containment, or manual account recovery.',
      content:
        '# Moderate User Access\n\nControl whether a Clerk user can sign in.\n\n## Steps\n1. Resolve the target user id first (see find-user) if you only have an email or name.\n2. Use Ban User to immediately block all sign-in attempts (e.g. for confirmed abuse); use Unban User to lift it once resolved.\n3. Use Lock User for a temporary, reversible hold (e.g. suspicious login pattern under review); use Unlock User to restore access.\n4. For a full audit trail, use Audit User Sessions afterward to revoke any sessions that should not continue.\n\n## Output\nReturn the user id and the resulting banned/locked flags after the action. State clearly which control was applied and why, so the moderation trail is auditable.',
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
        'Create or update a Clerk organization, manage its memberships, and invite new members. Use when provisioning a new team or tenant in a multi-tenant app, or when onboarding/offboarding members.',
      content:
        "# Manage Organization\n\nCreate, inspect, and staff a Clerk organization.\n\n## Steps\n1. To create, use Create Organization with the organization name and the Creator User ID (that user becomes the admin); optionally set a slug and max members. Use Update Organization to rename, re-slug, or change membership limits later.\n2. To inspect, use Get Organization by org id or slug, or List Organizations with a search query and include members count.\n3. To staff the org, use Add Organization Member with an existing user id and role, or Create Organization Invitation to invite someone by email who does not have an account yet.\n4. Use List Organization Memberships to see current members and their roles, Update Organization Membership to change a member's role, and Remove Organization Member to offboard someone.\n5. Use List Organization Invitations to check on pending invites.\n\n## Output\nReturn the organization id, name, slug, and member count. When adding or inviting a member, confirm the user id or email and the assigned role. When creating, confirm the admin user and echo the org id so it can be linked back to your billing or CRM record.",
    },
  ],
} as const satisfies BlockMeta
