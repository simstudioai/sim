import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const memberUsageLimitOperations = {
  /**
   * permission-group-exempt: administrators manage organization-funded credit caps independently of workspace capabilities.
   */
  read: defineOrganizationOperation({
    id: 'organization_member_usage_limits.read',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
  }),
  /**
   * permission-group-exempt: administrators set organization-funded credit caps independently of workspace capabilities.
   */
  update: defineOrganizationOperation({
    id: 'organization_member_usage_limits.update',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:write',
  }),
} as const
