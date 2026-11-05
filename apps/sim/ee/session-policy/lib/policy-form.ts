import {
  MAX_SESSION_POLICY_HOURS,
  MIN_IDLE_TIMEOUT_HOURS,
  MIN_SESSION_LIFETIME_HOURS,
} from '@/lib/api/contracts/organization'

function parseHours(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}

type SessionPolicyHours =
  | { ok: true; maxSessionHours: number | null; idleTimeoutHours: number | null }
  | { ok: false; error: string }

/** Empty means no limit; anything else must be a whole number the policy accepts. */
export function parseSessionPolicyHours(
  maxSessionHours: string,
  idleTimeoutHours: string
): SessionPolicyHours {
  const max = parseHours(maxSessionHours)
  const idle = parseHours(idleTimeoutHours)
  if (
    Number.isNaN(max) ||
    (max !== null && (max < MIN_SESSION_LIFETIME_HOURS || max > MAX_SESSION_POLICY_HOURS))
  ) {
    return {
      ok: false,
      error: `Max session lifetime must be a whole number between ${MIN_SESSION_LIFETIME_HOURS} and ${MAX_SESSION_POLICY_HOURS}`,
    }
  }
  if (
    Number.isNaN(idle) ||
    (idle !== null && (idle < MIN_IDLE_TIMEOUT_HOURS || idle > MAX_SESSION_POLICY_HOURS))
  ) {
    return {
      ok: false,
      error: `Idle timeout must be a whole number between ${MIN_IDLE_TIMEOUT_HOURS} and ${MAX_SESSION_POLICY_HOURS}`,
    }
  }
  return { ok: true, maxSessionHours: max, idleTimeoutHours: idle }
}
