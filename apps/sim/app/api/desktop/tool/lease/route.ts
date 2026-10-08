import { renewDesktopToolLeaseContract } from '@/lib/api/contracts/desktop-executor'
import { defineInternalJsonRoute, internalSessionAuth } from '@/lib/api/server/routes'
import {
  desktopExecutorErrorPolicy,
  desktopExecutorRateLimit,
} from '@/lib/api/server/routes/desktop-executor'
import { renewDesktopToolLease } from '@/lib/desktop/application/executor'

export const POST = defineInternalJsonRoute({
  contract: renewDesktopToolLeaseContract,
  auth: internalSessionAuth,
  operation: renewDesktopToolLease.operation,
  rateLimit: desktopExecutorRateLimit,
  errorPolicy: desktopExecutorErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: renewDesktopToolLease,
  staticResponseHeaders: { 'Cache-Control': 'no-store' },
})
