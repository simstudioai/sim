import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isAccessControlEnabled, isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AccessRequestContext } from '@/ee/access-requests/lib/application/authorization'
import { loadAccessRequestCatalog } from '@/ee/access-requests/lib/catalog'
import type { AccessRequestTarget } from '@/ee/access-requests/lib/targets'

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
  const [catalog, entitled] = await Promise.all([
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
  ])
  return { catalog, entitled }
}

export type PreparedAccessRequestPolicy = Awaited<ReturnType<typeof prepareAccessRequestPolicy>>
