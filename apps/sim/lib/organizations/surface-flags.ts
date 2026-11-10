import { createLogger } from '@sim/logger'
import { canUseBenchmarks } from '@/lib/benchmarks/config'
import { isChangelogEnabled } from '@/lib/changelog/feature-flag'
import { isComputerUseAvailable } from '@/lib/computer-use/availability.server'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { isDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { isMothershipModelSelectorEnabled } from '@/lib/mothership/feature-flags'
import { isProjectsEnabled } from '@/lib/projects/rollout.server'
import { isWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'

const logger = createLogger('OrganizationSurfaceFlags')

/**
 * The runtime flags the organization surface hands its client code, shared by the legacy layout and
 * the Platform's surface read so the two cannot resolve them differently.
 */
export async function resolveOrganizationSurfaceFlags(organizationId: string, userId: string) {
  const [
    modelSelectorEnabled,
    dashboardsEnabled,
    benchmarkEnabled,
    computerUseEnabled,
    workflowTestsEnabled,
    changelogEnabled,
    projectsEnabled,
    platformPreviewEnabled,
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
    },
  }
}
