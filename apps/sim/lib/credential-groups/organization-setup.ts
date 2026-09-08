import { OrchestrationError } from '@/lib/core/orchestration/types'
import { organizationAccountAccessPolicyCodec } from '@/lib/credential-groups/application/workspace-access-policy'
import type { DbOrTx } from '@/lib/db/types'
import {
  ResourcePolicyNotFoundError,
  requireResourcePolicy,
} from '@/lib/resource-policies/repository'

/** A v2 policy is created atomically with a fresh org group; legacy grants are never adopted automatically. */
export async function requireOrganizationAccountsSetup(
  organizationId: string,
  credentialGroupId: string,
  executor?: DbOrTx
): Promise<void> {
  try {
    await requireResourcePolicy(
      {
        organizationId,
        resourceType: 'credential_group',
        resourceId: credentialGroupId,
        codec: organizationAccountAccessPolicyCodec,
      },
      executor
    )
  } catch (error) {
    if (error instanceof ResourcePolicyNotFoundError)
      throw new OrchestrationError(
        'conflict',
        'Existing organization accounts require a migration review. Check Search dependencies and reconnect people before enabling workflow sharing.'
      )
    throw error
  }
}
