import { useFeatureFlag } from '@/lib/core/config/feature-flags-context'

/**
 * Whether a new key may be read-only. Off until every pod enforces key access;
 * existing read-only keys are enforced either way.
 */
export function useReadOnlyApiKeysEnabled(): boolean {
  return useFeatureFlag('api-key-read-only')
}
