import { canUseBenchmarks } from '@/lib/benchmarks/application/access'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** Model, effort and Fast controls share one deployment-wide AppConfig gate. */
export function isMothershipModelSelectorEnabled(): Promise<boolean> {
  return isFeatureEnabled('mothership-model-selector')
}

/** Plan shares benchmarking's deployment opt-in and effective super-user check. */
export function isPlanModeEnabled(userId: string): Promise<boolean> {
  return canUseBenchmarks(userId)
}

/** One AppConfig gate controls Search integration discovery, execution, and prompt capability. */
export function isSearchIntegrationToolsEnabled(): Promise<boolean> {
  return isFeatureEnabled('mothership-search-integration-tools')
}

/** Graph reads, writes and management use the same super-user gate as Plan and benchmarks. */
export function isMemorySpacesEnabled(userId: string): Promise<boolean> {
  return canUseBenchmarks(userId)
}
