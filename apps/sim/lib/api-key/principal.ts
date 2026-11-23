import type { PersonalApiKeyPrincipal, WorkspaceApiKeyPrincipal } from '@sim/auth/principal'
import type { ApiKeyAuthResult } from '@/lib/api-key/service'

/** The principal a successful `authenticateApiKeyFromHeader` result identifies. */
export function apiKeyPrincipal(
  result: ApiKeyAuthResult
): PersonalApiKeyPrincipal | WorkspaceApiKeyPrincipal {
  if (!result.success || !result.keyId || !result.keyType || !result.access) {
    throw new Error('API key authentication returned incomplete identity')
  }
  if (result.keyType === 'personal') {
    if (!result.userId) throw new Error('Personal API key authentication returned no owner')
    return {
      kind: 'personal_api_key',
      userId: result.userId,
      keyId: result.keyId,
      access: result.access,
    }
  }
  if (!result.workspaceId) {
    throw new Error('Workspace API key authentication returned no workspace scope')
  }
  return {
    kind: 'workspace_api_key',
    workspaceId: result.workspaceId,
    keyId: result.keyId,
    access: result.access,
  }
}
