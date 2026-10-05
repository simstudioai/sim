import { claimDesktopToolContract } from '@/lib/api/contracts/desktop-executor'
import { defineInternalJsonRoute, internalSessionAuth } from '@/lib/api/server/routes'
import {
  desktopExecutorErrorPolicy,
  desktopExecutorRateLimit,
} from '@/lib/api/server/routes/desktop-executor'
import { claimDesktopTool } from '@/lib/desktop/application/executor'

export const POST = defineInternalJsonRoute({
  contract: claimDesktopToolContract,
  auth: internalSessionAuth,
  operation: claimDesktopTool.operation,
  rateLimit: desktopExecutorRateLimit,
  errorPolicy: desktopExecutorErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: claimDesktopTool,
  present: (claim) => ({ ...claim, leaseExpiresAt: claim.leaseExpiresAt.toISOString() }),
  staticResponseHeaders: { 'Cache-Control': 'no-store' },
})
