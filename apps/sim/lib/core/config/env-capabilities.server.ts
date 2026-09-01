/**
 * Binds the pure capability definitions to the application's validated server environment.
 *
 * @packageDocumentation
 */

import { env } from '@/lib/core/config/env'
import {
  ASYNC_JOBS_CAPABILITY,
  CACHE_CAPABILITY,
  type ConfiguredOAuthClient,
  type FallbackCapabilityDefinition,
  inspectCapability,
  inspectOAuthClientCapability,
  type OAuthClientCapabilityField,
  type OAuthClientCapabilityId,
  requireCapability,
  requireOAuthClientCapability,
  SANDBOX_CAPABILITY,
  STORAGE_CAPABILITY,
  type WireFallbackOptions,
  wireFallback,
} from '@/lib/core/config/env-capabilities'

export function getConfiguredStorageProviderId() {
  return requireCapability(STORAGE_CAPABILITY, env).providerId
}

export function getConfiguredSandboxProviderId() {
  return requireCapability(SANDBOX_CAPABILITY, env).providerId
}

/**
 * Selects the sandbox adapter without requiring a Function-specific base image.
 * Each adapter validates the API key and image required by the requested sandbox
 * kind when it creates that sandbox.
 */
export function getSelectedSandboxProviderId() {
  const inspection = inspectCapability(SANDBOX_CAPABILITY, env)
  if (inspection.providerId !== null) return inspection.providerId
  if (inspection.error) throw inspection.error
  throw new Error('Remote sandbox has no selected provider')
}

export function getConfiguredAsyncJobsProvider() {
  return requireCapability(ASYNC_JOBS_CAPABILITY, env).providerId
}

export function getConfiguredCacheProvider() {
  return requireCapability(CACHE_CAPABILITY, env).providerId
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
