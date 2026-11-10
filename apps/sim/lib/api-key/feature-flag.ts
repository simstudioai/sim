import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/**
 * Whether new read-only API keys may be created. A pod older than the release
 * that enforces key access serves a read-only key as full access, so this turns
 * on only after every pod enforces it. Enforcement of existing read-only keys
 * never depends on it.
 */
export function isReadOnlyApiKeyCreationEnabled(): Promise<boolean> {
  return isFeatureEnabled('api-key-read-only')
}
