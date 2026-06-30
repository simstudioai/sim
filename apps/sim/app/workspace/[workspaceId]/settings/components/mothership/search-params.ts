import { parseAsStringLiteral } from 'nuqs/server'

/** Mothership admin tabs. */
export const MOTHERSHIP_TABS = ['overview', 'licenses', 'byok'] as const

export type MothershipTab = (typeof MOTHERSHIP_TABS)[number]

/**
 * Mothership environments. Mirrors the `MothershipEnv` union (including the
 * `default` member) so the literal parser accepts every value the selector and
 * query hooks emit, even though only dev/staging/prod are surfaced as buttons.
 */
export const MOTHERSHIP_ENVIRONMENTS = ['default', 'dev', 'staging', 'prod'] as const

export type MothershipEnvironmentParam = (typeof MOTHERSHIP_ENVIRONMENTS)[number]

/**
 * Co-located, typed URL query-param definitions for the Mothership admin view.
 *
 * - `tab` is the active section tab.
 * - `env` is the selected environment.
 *
 * The time-range inputs are free-form datetimes (not a finite enum) and
 * intentionally stay in local component state.
 */
export const mothershipParsers = {
  tab: parseAsStringLiteral(MOTHERSHIP_TABS).withDefault('overview'),
  env: parseAsStringLiteral(MOTHERSHIP_ENVIRONMENTS).withDefault('dev'),
} as const

/** Tab/environment view-state: clean URLs, no back-stack churn. */
export const mothershipUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
