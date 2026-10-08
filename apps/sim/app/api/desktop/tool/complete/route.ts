import { completeDesktopToolContract } from '@/lib/api/contracts/desktop-executor'
import { defineInternalJsonRoute, internalSessionAuth } from '@/lib/api/server/routes'
import {
  desktopExecutorErrorPolicy,
  desktopExecutorRateLimit,
} from '@/lib/api/server/routes/desktop-executor'
import { completeDesktopTool } from '@/lib/desktop/application/executor'

export const POST = defineInternalJsonRoute({
  contract: completeDesktopToolContract,
  auth: internalSessionAuth,
  operation: completeDesktopTool.operation,
  rateLimit: desktopExecutorRateLimit,
  errorPolicy: desktopExecutorErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: completeDesktopTool,
  present: ({ outcome, status }) => ({ outcome, status }),
  staticResponseHeaders: { 'Cache-Control': 'no-store' },
})
