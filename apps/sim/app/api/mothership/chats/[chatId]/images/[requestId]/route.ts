import { getInlineChatImageContract } from '@/lib/api/contracts/mothership-chat-images'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { readInlineChatImage } from '@/lib/mothership/chat/application/inline-images'

export const dynamic = 'force-dynamic'
export const GET = defineInternalBinaryRoute({
  contract: getInlineChatImageContract,
  auth: internalSessionAuth,
  operation: readInlineChatImage.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Bounded private chat image delivery requires current owner authorization.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ ...params, reference: query.path }),
  useCase: readInlineChatImage,
  present: ({ buffer, contentType }) => ({
    body: new Uint8Array(buffer),
    contentType,
    contentLength: buffer.length,
    contentDisposition: 'inline',
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  }),
})
