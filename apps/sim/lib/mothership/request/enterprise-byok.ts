import { getBYOKKey, getOrganizationBYOKKey } from '@/lib/api-key/byok'
import {
  isOrganizationOnEnterprisePlan,
  isWorkspaceOnEnterprisePlan,
} from '@/lib/billing/core/subscription'

/**
 * Enterprise credential failures must not silently send customer content on a hosted key. A
 * workspace chat resolves its workspace's key (which may inherit its organization's pool); an
 * organization chat, which has no workspace, resolves its organization's own pool. A personal
 * organization is never on Enterprise and holds no keys, so its chats use the hosted key as a
 * personal workspace's always did. A billing or key lookup that fails rejects rather than falling
 * back.
 */
export async function resolveEnterpriseByokKey(scope: {
  workspaceId?: string
  organizationId?: string
}): Promise<string | null> {
  if (scope.workspaceId) {
    if (!(await isWorkspaceOnEnterprisePlan(scope.workspaceId))) return null
    const byok = await getBYOKKey(scope.workspaceId, 'anthropic')
    return byok?.apiKey ?? null
  }
  if (!scope.organizationId) return null
  if (!(await isOrganizationOnEnterprisePlan(scope.organizationId, 'throw'))) return null
  const byok = await getOrganizationBYOKKey(scope.organizationId, 'anthropic')
  return byok?.apiKey ?? null
}
