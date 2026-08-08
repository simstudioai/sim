export { defineInternalBinaryRoute } from '@/lib/api/server/routes/internal-binary-route'
export {
  createInternalSessionOrServiceAuth,
  defineInternalJsonRoute,
  type InternalAuthPolicy,
  type InternalErrorPolicy,
  InternalUnauthenticatedError,
  internalOrchestrationErrorPolicy,
  internalPlainOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes/internal-json-route'
export { defineV2BinaryRoute } from '@/lib/api/server/routes/v2-binary-route'
export {
  defineV2JsonRoute,
  type V2ErrorPolicy,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes/v2-json-route'
