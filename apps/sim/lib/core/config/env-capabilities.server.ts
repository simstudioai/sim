/**
 * Binds the pure capability definitions to the application's validated server environment.
 *
 * @packageDocumentation
 */
import { env } from '@/lib/core/config/env'
import {
  EnvCapabilityConfigurationError,
  type FallbackCapabilityDefinition,
  resolveAsyncJobsProvider,
  resolveCacheProvider,
  resolveOAuthClientCapability,
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
  return resolveOAuthClientCapability(serviceId, env)
}

export function requireConfiguredOAuthClient(serviceId: string) {
  const inspection = inspectConfiguredOAuthClient(serviceId)
  if (inspection.state !== 'ready') {
    throw new EnvCapabilityConfigurationError(
      'oauth',
      `OAuth client ${serviceId} is not configured. Run ${inspection.setupCommand}.`
    )
  }
  return inspection
}

export function wireServerFallback<
  const TDefinition extends FallbackCapabilityDefinition,
  TProvider,
>(options: Omit<WireFallbackOptions<TDefinition, TProvider>, 'values'>) {
  return wireFallback({ ...options, values: env })
}
