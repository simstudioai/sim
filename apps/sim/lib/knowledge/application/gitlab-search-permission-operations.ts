import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const gitLabSearchPermissionOperations = {
  read: defineOrganizationOperation({
    minimumRole: 'admin',
    principalKinds: ['personal_api_key', 'oauth_access_token'],
    capability: 'knowledge.use',
    id: 'knowledge.search.gitlab_permissions.read',
    oauthScope: 'api:read',
  }),
  replace: defineOrganizationOperation({
    minimumRole: 'admin',
    principalKinds: ['personal_api_key', 'oauth_access_token'],
    capability: 'knowledge.use',
    id: 'knowledge.search.gitlab_permissions.replace',
    oauthScope: 'api:write',
  }),
} as const
