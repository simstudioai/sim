import { getBYOKKey } from '@/lib/api-key/byok'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing/core/subscription'

/** Enterprise credential failures must not silently send customer content on a hosted key. */
export async function resolveEnterpriseByokKey(
  workspaceId: string | undefined
): Promise<string | null> {
  if (!workspaceId || !(await isWorkspaceOnEnterprisePlan(workspaceId))) return null
  const byok = await getBYOKKey(workspaceId, 'anthropic')
  return byok?.apiKey ?? null
}
