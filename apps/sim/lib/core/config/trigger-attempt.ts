import { refreshAwsCredentialsForRun } from '@/lib/core/config/aws'
import { warmRedisConnection } from '@/lib/core/config/redis'

/**
 * The per-attempt setup the Trigger.dev `init` hook awaits before `run()`. Warms the shared Redis
 * connection, and refreshes workload-identity AWS credentials while the attempt is executing and a
 * token can still be minted, so work a run leaves behind (the hosted-key metrics flush) has
 * credentials after the attempt ends. Never throws, like each step: a throw in `init` fails the
 * attempt.
 */
export async function prepareTriggerAttempt(): Promise<void> {
  await Promise.all([warmRedisConnection(), refreshAwsCredentialsForRun()])
}
