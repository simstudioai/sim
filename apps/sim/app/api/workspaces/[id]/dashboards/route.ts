import { createDashboardContract, listDashboardsContract } from '@/lib/api/contracts/dashboards'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createDashboard, listDashboards } from '@/lib/dashboards/application/dashboards'
import { dashboardOperations } from '@/lib/dashboards/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listDashboardsContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.list,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, ...query }),
  useCase: listDashboards,
})

export const POST = defineInternalJsonRoute({
  contract: createDashboardContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.create,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: createDashboard,
})
