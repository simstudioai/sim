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
import { organizationSurfaceSettingsNavigation } from '@/lib/organizations/settings-sections'
import {
  getOrganizationSurfaceContext,
  type OrganizationSurfaceContext,
  resolveOrganizationLanding,
} from '@/lib/organizations/surface'
import { resolveOrganizationSurfaceFlags } from '@/lib/organizations/surface-flags'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'

const logger = createLogger('OrganizationSurfaceRead')

/** What a member's navigation and pages read about their surface, given the resolved context. */
async function resolveOrganizationSurface(
  context: OrganizationSurfaceContext,
  userId: string
): Promise<OrganizationSurfaceResponse> {
  const organizationId = context.organization.id
  const [{ flags, benchmarkEnabled }, people, simLinks, platformAdmin] = await Promise.all([
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
  ])

  return {
    organization: context.organization,
    viewer: context.viewer,
    mothershipAvailable: context.mothershipAvailable,
    searchAccess: context.searchAccess,
    connectedAccountsAvailable: context.connectedAccountsAvailable,
    settingsFeatures: context.settingsFeatures,
    deployment: context.deployment,
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

interface ReadOrganizationSurfaceInput {
  /** The organization to read; without one, the viewer's landing organization. */
  organizationId?: string
}

/**
 * The viewer's surface in a named organization, or, with none named, in the one they joined first.
 * Session active-organization state is not consulted. A named organization the viewer does not
 * belong to reads the same as having no membership at all.
 */
export const readOrganizationSurface: OperationUseCase<
  typeof organizationOperations.readSurface,
  ReadOrganizationSurfaceInput,
  OrganizationSurfaceResponse
> = {
  operation: organizationOperations.readSurface,
  async execute({ principal, input }) {
    if (principal.kind !== 'session') {
      throw new PrincipalKindAuthorizationError(
        principal.kind,
        organizationOperations.readSurface.id
      )
    }
    const { userId } = principal
    const organizationId = input.organizationId ?? (await resolveOrganizationLanding(userId, null))
    if (!organizationId) throw new OrganizationMembershipNotFoundError()
    await authorizeOrganizationOperation(principal, organizationOperations.readSurface, {
      organizationId,
    })
    const context = await getOrganizationSurfaceContext(organizationId, userId)
    if (!context) throw new OrganizationMembershipNotFoundError()

    return resolveOrganizationSurface(context, userId)
  },
}
