import { db } from '@sim/db'
import { env } from '@/lib/core/config/env'
import { isMothershipBenchmarkEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { verifyEffectiveSuperUser } from '@/lib/permissions/super-user'

/** Restart Sim after changing the benchmark flag in the deployment secret. */
function isBenchmarkEnabled(): boolean {
  return isMothershipBenchmarkEnabled
}

export async function canUseBenchmarks(userId: string, executor: DbOrTx = db): Promise<boolean> {
  if (!isBenchmarkEnabled()) return false
  return (await verifyEffectiveSuperUser(userId, executor)).effectiveSuperUser
}

export function requireBenchmarkEnabled(): void {
  if (!isBenchmarkEnabled()) throw new OrchestrationError('not_found', 'Benchmark is unavailable')
}

/** Benchmark requests never fall back to the production agent or a user's routing preference. */
export function getBenchmarkMothershipUrl(): string {
  requireBenchmarkEnabled()
  const url = env.MOTHERSHIP_BENCHMARK_URL ?? env.COPILOT_DEV_URL
  if (!url)
    throw new OrchestrationError('validation', 'Set MOTHERSHIP_BENCHMARK_URL to run benchmarks')
  return url.replace(/\/$/, '')
}
