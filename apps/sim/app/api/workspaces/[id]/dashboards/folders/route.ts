import {
  createDashboardFolderContract,
  deleteDashboardFolderContract,
  listDashboardFoldersContract,
  moveDashboardFolderContract,
} from '@/lib/api/contracts/dashboards'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  createDashboardFolder,
  deleteDashboardFolder,
  listDashboardFolders,
  moveDashboardFolder,
} from '@/lib/dashboards/application/folders'
import { dashboardOperations } from '@/lib/dashboards/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listDashboardFoldersContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.folders,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: listDashboardFolders,
})

export const POST = defineInternalJsonRoute({
  contract: createDashboardFolderContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.createFolder,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: createDashboardFolder,
})

export const PATCH = defineInternalJsonRoute({
  contract: moveDashboardFolderContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.moveFolder,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: moveDashboardFolder,
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteDashboardFolderContract,
  auth: internalSessionAuth,
  operation: dashboardOperations.deleteFolder,
  rateLimit: internalRateLimits.user({ bucketName: 'dashboards' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: deleteDashboardFolder,
})
