import { isEnabled } from '../environment'
import type { TelemetryState } from './state'

/**
 * The switch every CLI that reports usage honours before its own: `DO_NOT_TRACK=1`
 * expresses a lack of consent to any usage reporting, from any tool. Spec at
 * consoledonottrack.com; `true` is accepted as well, as Turborepo, Wrangler,
 * and the GitHub CLI do.
 */
export const DO_NOT_TRACK_VARIABLE = 'DO_NOT_TRACK'

/** The CLI's own switch, for turning reporting off in one environment or CI job. */
export const TELEMETRY_DISABLED_VARIABLE = 'SIM_TELEMETRY_DISABLED'

export type TelemetryDisabledReason =
  /** `DO_NOT_TRACK` is set. */
  | 'do_not_track'
  /** `SIM_TELEMETRY_DISABLED` is set. */
  | 'environment'
  /** The user ran `sim telemetry disable`. */
  | 'setting'
  /** This build was made without a reporting destination, so there is nowhere to send to. */
  | 'unconfigured'

export type TelemetryStatus =
  | { enabled: true }
  | { enabled: false; reason: TelemetryDisabledReason }

export interface TelemetryStatusInput {
  env: NodeJS.ProcessEnv
  state: Pick<TelemetryState, 'enabled'>
  /** Whether the build carries a reporting destination. */
  configured: boolean
}

/**
 * Whether usage reporting is on, and if not, the first reason that turns it
 * off. The order is the order of authority: the universal opt-out, then the
 * environment, then the saved setting, then whether this build can report at
 * all — so `sim telemetry status` names the reason the user can act on.
 */
export function telemetryStatus({ env, state, configured }: TelemetryStatusInput): TelemetryStatus {
  if (isEnabled(env[DO_NOT_TRACK_VARIABLE])) return { enabled: false, reason: 'do_not_track' }
  if (isEnabled(env[TELEMETRY_DISABLED_VARIABLE])) return { enabled: false, reason: 'environment' }
  if (state.enabled === false) return { enabled: false, reason: 'setting' }
  if (!configured) return { enabled: false, reason: 'unconfigured' }
  return { enabled: true }
}
