import { getWorkspaceSettingsNavigationContract } from '@/lib/api/contracts/workspace-settings'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  readWorkspaceSettingsNavigation,
  readWorkspaceSettingsNavigationOperation,
} from '@/lib/settings/application/workspace-navigation'

export const GET = defineInternalJsonRoute({
  contract: getWorkspaceSettingsNavigationContract,
  auth: internalSessionAuth,
  operation: readWorkspaceSettingsNavigationOperation,
  rateLimit: internalRateLimits.none({
    reason: 'Read-only settings navigation, matching existing settings-page admission',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: readWorkspaceSettingsNavigation,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
