import type { OrganizationNetwork } from '@/lib/api/contracts/organization-network'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { resolveOutboundRoute } from '@/lib/core/network/config.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'

/**
 * permission-group-exempt: Network settings are governed by organization administrator membership.
 */
export const readOrganizationNetworkOperation = defineOrganizationOperation({
  id: 'organization.network.read',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'none',
})

export const readOrganizationNetwork: OperationUseCase<
  typeof readOrganizationNetworkOperation,
  { organizationId: string },
  OrganizationNetwork
> = {
  operation: readOrganizationNetworkOperation,
  async execute({ principal, input }) {
    const context = await authorizeOrganizationOperation(
      principal,
      readOrganizationNetworkOperation,
      input
    )
    if (
      !(await authorizeOrganizationSettingsSection({
        ...context,
        section: 'security',
      }))
    ) {
      throw new OrchestrationError('forbidden', 'Network settings are not available')
    }
    try {
      const route = await resolveOutboundRoute(context.organizationId)
      if (route.kind === 'direct') return { mode: 'direct' }
      return {
        mode: 'gateway',
        publicIps: [...(route.gateway.publicIps ?? [])],
      }
    } catch (error) {
      if (!(error instanceof OutboundRoutingError)) throw error
      return { mode: error.code === 'ROUTE_BLOCKED' ? 'blocked' : 'unavailable' }
    }
  },
}
