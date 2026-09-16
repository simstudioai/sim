import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isAccessControlEnabled, isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AccessRequestContext } from '@/lib/permission-access-requests/application/authorization'
import { loadAccessRequestCatalog } from '@/lib/permission-access-requests/catalog'
import type { AccessRequestTarget } from '@/lib/permission-groups/access-requests/targets'

/** Resolve deployment metadata before opening a transaction or taking policy locks. */
export async function prepareAccessRequestPolicy(
  context: Pick<AccessRequestContext, 'organizationId' | 'workspaceId'>,
  userId: string,
  targetKind?: AccessRequestTarget['kind']
) {
  if (!context.organizationId)
    throw new OrchestrationError(
      'forbidden',
      'Access requests require an organization-owned workspace'
    )
  const [catalog, entitled, globalEnabled] = await Promise.all([
    loadAccessRequestCatalog(
      {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        userId,
      },
      targetKind
    ),
    isHosted
      ? isOrganizationOnEnterprisePlan(context.organizationId)
      : Promise.resolve(isAccessControlEnabled),
    isFeatureEnabled('permission-access-requests'),
  ])
  return { catalog, entitled, globalEnabled }
}

export type PreparedAccessRequestPolicy = Awaited<ReturnType<typeof prepareAccessRequestPolicy>>
