import { createDesktopSourceRequestContract } from '@/lib/api/contracts/desktop-source-connect'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createDesktopSourceRequest } from '@/lib/desktop/application/source-requests'

export const POST = defineInternalJsonRoute({
  contract: createDesktopSourceRequestContract,
  auth: internalSessionAuth,
  operation: createDesktopSourceRequest.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'desktop-source-connect' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: 64 * 1024 },
  mapInput: ({ body }) => ({ requestId: body.requestId, payload: JSON.stringify(body.request) }),
  useCase: createDesktopSourceRequest,
  staticResponseHeaders: { 'Cache-Control': 'no-store' },
})
