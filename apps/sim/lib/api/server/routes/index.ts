export { defineInternalBinaryRoute } from '@/lib/api/server/routes/internal-binary-route'
export {
  createInternalSessionOrExecutorAuth,
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  type InternalAuthPolicy,
  type InternalErrorPolicy,
  InternalUnauthenticatedError,
  internalErrorResponse,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes/internal-json-route'
export {
  concealCrossTenantResourceError,
  createInternalResourceConcealmentPolicy,
  createV2ResourceConcealmentPolicy,
} from '@/lib/api/server/routes/resource-concealment'
export {
  createScimRouteBuilder,
  defineScimDiscoveryRoute,
} from '@/lib/api/server/routes/scim-route'
export { defineV2BinaryRoute } from '@/lib/api/server/routes/v2-binary-route'
export { defineV2BodyLifecycleRoute } from '@/lib/api/server/routes/v2-body-lifecycle-route'
export {
  admitOptionalV2Request,
  admitV2Request,
  defineV2JsonRoute,
  V2_PARSE_DEFAULTS,
  type V2ErrorPolicy,
  V2RouteInfrastructureError,
  v2ApiKeyAuth,
  /** The media-type-aware 415 a raw route installs over {@link V2_PARSE_DEFAULTS}. */
  v2InvalidBodyResponse,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes/v2-json-route'
