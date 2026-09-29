import { env } from '@/lib/core/config/env'
import { isMothershipBenchmarkEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export function isBenchmarkEnabled(): boolean {
  return isMothershipBenchmarkEnabled
}

export function requireBenchmarkEnabled(): void {
  if (!isBenchmarkEnabled()) throw new OrchestrationError('not_found', 'Benchmark is unavailable')
}

/** Benchmark requests never fall back to the production agent or a user's routing preference. */
export function getBenchmarkMothershipUrl(): string {
  requireBenchmarkEnabled()
  const url = env.COPILOT_DEV_URL
  if (!url) throw new OrchestrationError('validation', 'Set COPILOT_DEV_URL to run benchmarks')
  return url.replace(/\/$/, '')
}
