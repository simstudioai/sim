import {
  deleteDashboardContract,
  moveDashboardContract,
  readDashboardContract,
  updateDashboardContract,
} from '@/lib/api/contracts/dashboards'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  deleteDashboard,
  moveDashboard,
  readDashboard,
  updateDashboard,
} from '@/lib/dashboards/application/dashboards'
import { dashboardOperations } from '@/lib/dashboards/application/operations'

export const GET = defineInternalJsonRoute({
  contract: readDashboardContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, dashboardId: params.dashboardId }),
  useCase: readDashboard,
})

export const PUT = defineInternalJsonRoute({
  contract: updateDashboardContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.update,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    dashboardId: params.dashboardId,
    ...body,
  }),
  useCase: updateDashboard,
})

export const PATCH = defineInternalJsonRoute({
  contract: moveDashboardContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.move,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    dashboardId: params.dashboardId,
    ...body,
  }),
  useCase: moveDashboard,
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteDashboardContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.delete,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, dashboardId: params.dashboardId }),
  useCase: deleteDashboard,
})
