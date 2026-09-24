import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** Re-evaluates the global rollout at every server admission boundary. */
export async function isComputerUseAvailable(): Promise<boolean> {
  return isFeatureEnabled('mothership-computer-use')
}
