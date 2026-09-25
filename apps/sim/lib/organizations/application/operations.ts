import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const organizationOperations = {
  /**
   * permission-group-exempt: membership discovery has no resource capability; credential policy is rechecked for each organization.
   */
  list: defineOrganizationOperation({
    id: 'organizations.list',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: organization metadata is available to its members independently of its member directory.
   */
  read: defineOrganizationOperation({
    id: 'organizations.read',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: administrators must be able to discover workspaces they govern.
   */
  listWorkspaces: defineOrganizationOperation({
    id: 'organizations.workspaces.list',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: the application enforces organization.member_directory for ordinary members; administrators retain access to member and seat administration.
   */
  listMembers: defineOrganizationOperation({
    id: 'organizations.members.list',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: organization administrators manage member roles independently of member-directory visibility.
   */
  updateMember: defineOrganizationOperation({
    id: 'organizations.members.update',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: the application allows administrators to remove members and members to leave their own organization.
   */
  removeMember: defineOrganizationOperation({
    id: 'organizations.members.remove',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    oauthScope: 'api:write',
  }),
  /**
   * permission-group-exempt: administrators can inspect existing invitations even when new invitations are disabled.
   */
  listInvitations: defineOrganizationOperation({
    id: 'organizations.invitations.list',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: inspecting an invitation does not admit a new member.
   */
  readInvitation: defineOrganizationOperation({
    id: 'organizations.invitations.read',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: administrators can inspect existing invitation grants when invitations are disabled.
   */
  listInvitationWorkspaces: defineOrganizationOperation({
    id: 'organizations.invitations.workspaces.list',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
  }),
  createInvitation: defineOrganizationOperation({
    id: 'organizations.invitations.create',
    minimumRole: 'admin',
    capability: 'invitations.send',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    oauthScope: 'api:write',
  }),
} as const

export const organizationSettingsOperations = {
  /** permission-group-exempt: organization members may read their organization's identity. */
  read: defineOrganizationOperation({
    id: 'organization.settings.read',
    minimumRole: 'member',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    capability: 'none',
  }),
  /** permission-group-exempt: organization administrators manage its identity. */
  update: defineOrganizationOperation({
    id: 'organization.settings.update',
    minimumRole: 'admin',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    capability: 'none',
  }),
} as const
