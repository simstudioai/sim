import { ANONYMOUS_USER_ID } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'
import type { OperationUseCase } from '@/lib/core/application/operation'
import {
  authorizeOrganizationOperation,
  OrganizationMembershipNotFoundError,
} from '@/lib/core/application/organization-authorization'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { organizationOperations } from '@/lib/organizations/application/operations'
import {
  getOrganizationSurfaceContext,
  type OrganizationSurfaceContext,
  resolveOrganizationLanding,
} from '@/lib/organizations/surface'
import { resolveOrganizationSurfaceFlags } from '@/lib/organizations/surface-flags'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { isPlatformOrgUiEnabled } from '@/lib/platform/rollout'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { organizationSurfaceSettingsNavigation } from '@/app/o/[organizationId]/settings/navigation'

const logger = createLogger('OrganizationSurfaceRead')

/** What a member's navigation and pages read about their surface, given the resolved context. */
export async function resolveOrganizationSurface(
  context: OrganizationSurfaceContext,
  userId: string
): Promise<OrganizationSurfaceResponse> {
  const organizationId = context.organization.id
  const [{ flags, benchmarkEnabled }, people, simLinks, platformAdmin, platformOrgUi] =
    await Promise.all([
      resolveOrganizationSurfaceFlags(organizationId, userId),
      canBrowsePeople(organizationId, context.viewer.role),
      isSimLinksEnabled(organizationId),
      // Decides which links are drawn; the pages behind them authorize for themselves.
      isPlatformAdmin(userId).catch((error: unknown) => {
        logger.warn('Could not resolve platform administration navigation', {
          error: getErrorMessage(error),
        })
        return false
      }),
      isPlatformOrgUiEnabled(organizationId),
    ])

  return {
    organization: context.organization,
    viewer: context.viewer,
    mothershipAvailable: context.mothershipAvailable,
    canBuild: context.canBuild,
    searchAccess: context.searchAccess,
    connectedAccountsAvailable: context.connectedAccountsAvailable,
    settingsFeatures: context.settingsFeatures,
    deployment: context.deployment,
    platformOrgUi,
    navFlags: {
      people,
      simLinks,
      benchmark: benchmarkEnabled,
      platformAdmin,
      anonymous: userId === ANONYMOUS_USER_ID,
    },
    featureFlags: flags,
    settingsSections: organizationSurfaceSettingsNavigation(
      context.viewer.isAdmin,
      context.settingsFeatures,
      {
        connectedAccounts: context.connectedAccountsAvailable,
        search: context.searchAccess.memberScoped,
        knowledgeGraphs: flags['mothership-memory-spaces'],
      },
      platformAdmin
    ).map((item) => item.id),
  }
}

/**
 * The viewer's organization surface, resolved from their membership. A member belongs to one
 * organization, so the caller names none and session active-organization state is not consulted.
 * Having no membership reads the same as not being a member of a named organization.
 */
export const readOrganizationSurface: OperationUseCase<
  typeof organizationOperations.readSurface,
  Record<string, never>,
  OrganizationSurfaceResponse
> = {
  operation: organizationOperations.readSurface,
  async execute({ principal }) {
    if (principal.kind !== 'session') {
      throw new PrincipalKindAuthorizationError(
        principal.kind,
        organizationOperations.readSurface.id
      )
    }
    const { userId } = principal
    const organizationId = await resolveOrganizationLanding(userId, null)
    if (!organizationId) throw new OrganizationMembershipNotFoundError()
    await authorizeOrganizationOperation(principal, organizationOperations.readSurface, {
      organizationId,
    })
    const context = await getOrganizationSurfaceContext(organizationId, userId)
    if (!context) throw new OrganizationMembershipNotFoundError()

    return resolveOrganizationSurface(context, userId)
  },
}
