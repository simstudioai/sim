/**
 * Binds the pure capability definitions to the application's validated server environment.
 *
 * @packageDocumentation
 */
import { env } from '@/lib/core/config/env'
import {
  type ConfiguredOAuthClient,
  type FallbackCapabilityDefinition,
  inspectOAuthClientCapability,
  type OAuthClientCapabilityField,
  type OAuthClientCapabilityId,
  requireOAuthClientCapability,
  resolveAsyncJobsProvider,
  resolveCacheProvider,
  resolveSandboxProviderId,
  resolveSelectedCapability,
  STORAGE_CAPABILITY,
  type WireFallbackOptions,
  wireFallback,
} from '@/lib/core/config/env-capabilities'

export function getConfiguredStorageProviderId() {
  return resolveSelectedCapability(STORAGE_CAPABILITY, env).providerId
}

export function getConfiguredSandboxProviderId() {
  return resolveSandboxProviderId(env)
}

export function getConfiguredAsyncJobsProvider() {
  return resolveAsyncJobsProvider(env)
}

export function getConfiguredCacheProvider() {
  return resolveCacheProvider(env)
}

export function inspectConfiguredOAuthClient(serviceId: string) {
  return inspectOAuthClientCapability(serviceId, env)
}

export function requireConfiguredOAuthClient<const TCapabilityId extends OAuthClientCapabilityId>(
  serviceId: TCapabilityId
): ConfiguredOAuthClient<OAuthClientCapabilityField<TCapabilityId>>
export function requireConfiguredOAuthClient(serviceId: string): ConfiguredOAuthClient
export function requireConfiguredOAuthClient(serviceId: string): ConfiguredOAuthClient {
  return requireOAuthClientCapability(serviceId, env)
}

export function wireServerFallback<
  const TDefinition extends FallbackCapabilityDefinition,
  TProvider,
>(options: Omit<WireFallbackOptions<TDefinition, TProvider>, 'values'>) {
  return wireFallback({ ...options, values: env })
}
