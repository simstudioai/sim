import { ANONYMOUS_USER_ID } from '@sim/auth/principal'
import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import type { OrganizationSurfaceResponse } from '@/lib/api/contracts/organization'
import { isReadOnlyApiKeyCreationEnabled } from '@/lib/api-key/feature-flag'
import { canUseBenchmarks } from '@/lib/benchmarks/config'
import { isChangelogEnabled } from '@/lib/changelog/feature-flag'
import { isComputerUseAvailable } from '@/lib/computer-use/availability.server'
import type { OperationUseCase } from '@/lib/core/application/operation'
import {
  authorizeOrganizationOperation,
  OrganizationMembershipNotFoundError,
} from '@/lib/core/application/organization-authorization'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { isDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { isMothershipModelSelectorEnabled } from '@/lib/mothership/feature-flags'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { organizationSurfaceSettingsNavigation } from '@/lib/organizations/settings-sections'
import {
  getOrganizationSurfaceContext,
  type OrganizationSurfaceContext,
  resolveOrganizationLanding,
} from '@/lib/organizations/surface'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { isProjectsEnabled } from '@/lib/projects/rollout.server'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { isWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'

const logger = createLogger('OrganizationSurfaceRead')

/**
 * The named organization no longer exists, as a personal organization retired by a team join. It
 * still reads as no membership; a surface that can send the viewer elsewhere tells it apart.
 */
export class OrganizationNotFoundError extends OrganizationMembershipNotFoundError {}

async function organizationExists(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return Boolean(row)
}

/** The runtime flags the organization surface hands its client code. */
async function resolveOrganizationSurfaceFlags(organizationId: string, userId: string) {
  const [
    modelSelectorEnabled,
    dashboardsEnabled,
    benchmarkEnabled,
    computerUseEnabled,
    workflowTestsEnabled,
    changelogEnabled,
    projectsEnabled,
    platformPreviewEnabled,
    readOnlyApiKeysEnabled,
  ] = await Promise.all([
    isMothershipModelSelectorEnabled(),
    isDashboardsEnabled(organizationId),
    canUseBenchmarks(userId).catch(() => {
      logger.warn('Could not resolve benchmark navigation access')
      return false
    }),
    isComputerUseAvailable(organizationId),
    isWorkflowTestsEnabled(organizationId),
    isChangelogEnabled(organizationId),
    isProjectsEnabled(),
    isFeatureEnabled('platform-preview'),
    isReadOnlyApiKeyCreationEnabled(),
  ])
  return {
    benchmarkEnabled,
    flags: {
      dashboards: dashboardsEnabled,
      'workflow-tests': workflowTestsEnabled,
      changelog: changelogEnabled,
      'mothership-model-selector': modelSelectorEnabled,
      'mothership-computer-use': computerUseEnabled,
      'mothership-plan-mode': benchmarkEnabled,
      'mothership-memory-spaces': benchmarkEnabled,
      projects: projectsEnabled,
      'platform-preview': platformPreviewEnabled,
      'api-key-read-only': readOnlyApiKeysEnabled,
    },
  }
}

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
 * belong to reads the same as having no membership at all; one that no longer exists throws the
 * narrower `OrganizationNotFoundError`.
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
    try {
      await authorizeOrganizationOperation(principal, organizationOperations.readSurface, {
        organizationId,
      })
    } catch (error) {
      if (
        input.organizationId &&
        error instanceof OrganizationMembershipNotFoundError &&
        !(await organizationExists(organizationId))
      )
        throw new OrganizationNotFoundError()
      throw error
    }
    const context = await getOrganizationSurfaceContext(organizationId, userId)
    if (!context) throw new OrganizationMembershipNotFoundError()

    return resolveOrganizationSurface(context, userId)
  },
}
