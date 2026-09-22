import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import type { ResourceOwner } from '@/lib/core/resource-scope'
import { resolveKnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'
import {
  defaultLiveSearchPolicy,
  liveSearchPolicySchema,
} from '@/lib/sim-search/live/policy-schema'

/** Called only inside authorized application use cases; never caches authorization policy. */
export async function loadLiveSearchPolicies(owner: ResourceOwner) {
  const organizationId =
    owner.organizationId ??
    (owner.workspaceId
      ? (await resolveKnowledgeWorkspaceContext({ workspaceId: owner.workspaceId }))
          .workspaceOrganizationId
      : undefined)
  if (!organizationId) return {}
  const [row] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!row) throw new Error('Search organization is unavailable')
  return toRecord(toRecord(row.metadata).liveSearchPolicies)
}

/** Invalid saved policies fail closed instead of falling back to unrestricted search. */
export function livePolicyFor(policies: Record<string, unknown>, provider: string) {
  if (policies[provider] === undefined) return defaultLiveSearchPolicy(provider)
  const policy = liveSearchPolicySchema.parse(policies[provider])
  if (provider === 'gitlab') return { ...policy, accessMode: 'service_account' as const }
  return policy.accessMode === 'service_account' ? policy : defaultLiveSearchPolicy(provider)
}
