import { listDesktopInboxContract } from '@/lib/api/contracts/desktop-executor'
import { defineInternalJsonRoute, internalSessionAuth } from '@/lib/api/server/routes'
import {
  desktopExecutorErrorPolicy,
  desktopExecutorRateLimit,
} from '@/lib/api/server/routes/desktop-executor'
import { listDesktopInbox } from '@/lib/desktop/application/executor'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: listDesktopInboxContract,
  auth: internalSessionAuth,
  operation: listDesktopInbox.operation,
  rateLimit: desktopExecutorRateLimit,
  errorPolicy: desktopExecutorErrorPolicy,
  mapInput: ({ query }) => ({ deviceId: query.deviceId }),
  useCase: listDesktopInbox,
  present: ({ items, hasActiveRun }) => ({
    hasActiveRun,
    items: items.map((item) =>
      item.kind === 'call' ? { ...item, createdAt: item.createdAt.toISOString() } : item
    ),
  }),
  staticResponseHeaders: { 'Cache-Control': 'no-store' },
})
