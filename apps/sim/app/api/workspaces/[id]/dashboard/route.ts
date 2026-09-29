import {
  deleteWorkspaceDashboardContract,
  readWorkspaceDashboardContract,
} from '@/lib/api/contracts/dashboards'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  deleteWorkspaceDashboard,
  readWorkspaceDashboard,
} from '@/lib/dashboards/application/dashboards'
import { dashboardOperations } from '@/lib/dashboards/application/operations'

export const GET = defineInternalJsonRoute({
  contract: readWorkspaceDashboardContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: readWorkspaceDashboard,
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkspaceDashboardContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.delete,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: deleteWorkspaceDashboard,
})
