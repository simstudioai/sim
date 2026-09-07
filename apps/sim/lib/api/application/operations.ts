import { defineOperation } from '@/lib/core/application/operation'

/**
 * Operations a credential performs on itself.
 *
 * They carry no workspace scope and no role: the resource *is* the
 * authenticated key, so holding it is the whole authorization story. What is
 * left — which kinds of principal may hold that resource — is declared here as
 * data through {@link defineOperation}, so the policy is inspectable rather
 * than hand-rolled inside the use case.
 */
export const v2MetaOperations = {
  // permission-group-exempt: the resource is the API key the caller already proved it holds, and reporting what that key can do withholds nothing a group could
  read: defineOperation({
    id: 'meta.capabilities.read',
    oauthScope: 'api:read',
    capability: 'none',
    principalKinds: ['personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
} as const
