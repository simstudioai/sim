import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** Default Trigger.dev region — the project default when the eu-central flag is off. */
export const TRIGGER_REGION_US_EAST = 'us-east-1'

/** Target region when the `trigger-eu-region` flag is enabled. */
export const TRIGGER_REGION_EU_CENTRAL = 'eu-central-1'

/**
 * Resolve which Trigger.dev region a run should execute in. Gated globally by the
 * `trigger-eu-region` feature flag (all-or-nothing — no per-user/org targeting):
 * `eu-central-1` when enabled, otherwise `us-east-1`.
 *
 * The result is passed as the `region` option to `tasks.trigger` / `batchTrigger`,
 * overriding the project's dashboard default per run.
 */
export async function resolveTriggerRegion(): Promise<string> {
  return (await isFeatureEnabled('trigger-eu-region'))
    ? TRIGGER_REGION_EU_CENTRAL
    : TRIGGER_REGION_US_EAST
}
