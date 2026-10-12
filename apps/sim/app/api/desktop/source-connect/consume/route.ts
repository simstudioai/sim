import {
  consumeDesktopSourceRequestContract,
  desktopSourceRequestSchema,
} from '@/lib/api/contracts/desktop-source-connect'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { consumeDesktopSourceRequest } from '@/lib/desktop/application/source-requests'

export const POST = defineInternalJsonRoute({
  contract: consumeDesktopSourceRequestContract,
  auth: internalSessionAuth,
  operation: consumeDesktopSourceRequest.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'desktop-source-connect' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: consumeDesktopSourceRequest,
  present: ({ payload }) => desktopSourceRequestSchema.parse(JSON.parse(payload)),
  staticResponseHeaders: { 'Cache-Control': 'no-store' },
})
