import { envNumber } from '@/lib/core/config/env'

/**
 * `COST_MULTIPLIER` arrives as a raw string under `skipValidation` (see `envNumber`).
 * A string multiplier fails the finite check every sandbox lease runs — on dev, every
 * `run_code` died as "Boot sandbox" until the value was normalized at this boundary.
 * Outside production the multiplier is always 1.
 */
export function resolveCostMultiplier(
  raw: number | string | undefined | null,
  prod: boolean
): number {
  return prod ? envNumber(raw, 1) : 1
}
