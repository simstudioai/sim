import { listDesktopActivityContract } from '@/lib/api/contracts/desktop-executor'
import { defineInternalJsonRoute, internalSessionAuth } from '@/lib/api/server/routes'
import {
  desktopActivityRateLimit,
  desktopExecutorErrorPolicy,
} from '@/lib/api/server/routes/desktop-executor'
import { listDesktopActivity } from '@/lib/desktop/application/activity'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: listDesktopActivityContract,
  auth: internalSessionAuth,
  operation: listDesktopActivity.operation,
  rateLimit: desktopActivityRateLimit,
  errorPolicy: desktopExecutorErrorPolicy,
  mapInput: ({ query }) => ({ workspaceId: query.workspaceId }),
  useCase: listDesktopActivity,
  staticResponseHeaders: { 'Cache-Control': 'no-store' },
})
