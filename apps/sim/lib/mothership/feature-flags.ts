import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** Model, effort and Fast controls share one deployment-wide AppConfig gate. */
export function isMothershipModelSelectorEnabled(): Promise<boolean> {
  return isFeatureEnabled('mothership-model-selector')
}

/** The same runtime gate controls Plan visibility and server admission. */
export function isPlanModeEnabled(): Promise<boolean> {
  return isFeatureEnabled('mothership-plan-mode')
}

/** One AppConfig gate controls Search integration discovery, execution, and prompt capability. */
export function isSearchIntegrationToolsEnabled(): Promise<boolean> {
  return isFeatureEnabled('mothership-search-integration-tools')
}
