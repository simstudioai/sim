/**
 * Who may create an account on a deployment, and whether email/password and
 * email OTP work at all, as one setting: `REGISTRATION_MODE`.
 *
 * | Mode              | Self-serve signup          | Email/password + OTP sign-in |
 * | ----------------- | -------------------------- | ---------------------------- |
 * | `open` (default)  | every method               | on                           |
 * | `no-email-signup` | social only                | on                           |
 * | `closed`          | none                       | on                           |
 * | `no-email`        | social only                | off, for every account       |
 * | `closed-no-email` | none                       | off, for every account       |
 *
 * No mode affects single sign-on just-in-time provisioning, SCIM, or
 * `DISABLE_AUTH`: those create users outside self-serve signup.
 *
 * The value is safe for any visitor to see, so the server projects it to the
 * browser through the deployment shape. Server enforcement lives in
 * `apps/sim/lib/auth/auth.ts`; `packages/sim-setup` validates the same value.
 *
 * Kept dependency-free: `apps/sim/lib/core/config/env-flags.ts` imports it and
 * is loaded by `next.config.ts` before the `@/` alias exists.
 */

/** The environment variable that selects the mode. */
export const REGISTRATION_MODE_ENV_VAR = 'REGISTRATION_MODE'

export const REGISTRATION_MODES = [
  'open',
  'no-email-signup',
  'closed',
  'no-email',
  'closed-no-email',
] as const

export type RegistrationMode = (typeof REGISTRATION_MODES)[number]

/**
 * The variables `REGISTRATION_MODE` replaces. Each still works, with a
 * deprecation warning, so upgrading never reopens a deployment.
 */
export const DEPRECATED_REGISTRATION_ENV_VARS = {
  disableRegistration: 'DISABLE_REGISTRATION',
  disableEmailSignup: 'DISABLE_EMAIL_SIGNUP',
  emailPasswordSignupEnabled: 'EMAIL_PASSWORD_SIGNUP_ENABLED',
  publicEmailPasswordSignupEnabled: 'NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED',
} as const

type LegacyRegistrationKey = keyof typeof DEPRECATED_REGISTRATION_ENV_VARS

/** A raw environment value: a string from `process.env` or an env file, or a boolean from a test. */
type EnvValue = string | boolean | undefined

export interface RegistrationModeInput {
  /** The raw `REGISTRATION_MODE` value. */
  mode: string | undefined
  /** The raw values of {@link DEPRECATED_REGISTRATION_ENV_VARS}. */
  legacy: Partial<Record<LegacyRegistrationKey, EnvValue>>
}

type RegistrationModeWarningCode = 'invalid-mode' | 'deprecated-variables' | 'conflict'

/**
 * Something the operator should fix. `message` is static so it can be logged
 * as-is; the values that explain it are in `details`.
 */
interface RegistrationModeWarning {
  code: RegistrationModeWarningCode
  severity: 'error' | 'warn'
  message: string
  details: Record<string, string | readonly string[]>
}

interface RegistrationModeResolution {
  mode: RegistrationMode
  warnings: RegistrationModeWarning[]
}

/** What a mode allows, for the code that enforces or renders it. */
interface RegistrationPolicy {
  /** No self-serve account creation by any method, social included. */
  selfServeRegistrationClosed: boolean
  /** New accounts may sign up with email/password or email OTP. */
  emailSignupAllowed: boolean
  /** Email/password and email OTP work at all, sign-in included. */
  emailPasswordAuthEnabled: boolean
}

/** Self-serve signup, ordered from least to most restrictive. */
const SIGNUP_LEVELS = ['open', 'no-email-signup', 'closed'] as const
type SignupLevel = (typeof SIGNUP_LEVELS)[number]

interface RegistrationAxes {
  signup: SignupLevel
  emailAuth: boolean
}

const MODE_AXES: Record<RegistrationMode, RegistrationAxes> = {
  open: { signup: 'open', emailAuth: true },
  'no-email-signup': { signup: 'no-email-signup', emailAuth: true },
  closed: { signup: 'closed', emailAuth: true },
  'no-email': { signup: 'open', emailAuth: false },
  'closed-no-email': { signup: 'closed', emailAuth: false },
}

/** With email auth off, email signup is already impossible, so `no-email-signup` folds into `no-email`. */
function modeFromAxes({ signup, emailAuth }: RegistrationAxes): RegistrationMode {
  if (!emailAuth) return signup === 'closed' ? 'closed-no-email' : 'no-email'
  return signup
}

function mostRestrictive(a: RegistrationAxes, b: RegistrationAxes): RegistrationAxes {
  return {
    signup:
      SIGNUP_LEVELS[Math.max(SIGNUP_LEVELS.indexOf(a.signup), SIGNUP_LEVELS.indexOf(b.signup))],
    emailAuth: a.emailAuth && b.emailAuth,
  }
}

function normalize(value: EnvValue): string | boolean | undefined {
  if (typeof value !== 'string') return value
  const trimmed = value.trim().toLowerCase()
  return trimmed === '' ? undefined : trimmed
}

/** The legacy flags' own truthiness: `true` or `1`. */
function isOn(value: EnvValue): boolean {
  const normalized = normalize(value)
  return normalized === true || normalized === 'true' || normalized === '1'
}

/** `EMAIL_PASSWORD_SIGNUP_ENABLED` defaulted on, so only an explicit `false` or `0` turned it off. */
function isOff(value: EnvValue): boolean {
  const normalized = normalize(value)
  return normalized === false || normalized === 'false' || normalized === '0'
}

export function isRegistrationMode(value: unknown): value is RegistrationMode {
  return typeof value === 'string' && (REGISTRATION_MODES as readonly string[]).includes(value)
}

/**
 * Resolves `REGISTRATION_MODE` and the variables it replaces into one mode.
 *
 * Fails closed throughout. An unrecognized value closes self-serve
 * registration (sign-in keeps working, so nobody is locked out). The
 * deprecated variables keep their meaning, and when they are set alongside
 * `REGISTRATION_MODE` the most restrictive value wins on each axis, so an
 * operator adopting the new variable can never reopen signup by accident.
 */
export function resolveRegistrationMode({
  mode,
  legacy,
}: RegistrationModeInput): RegistrationModeResolution {
  const warnings: RegistrationModeWarning[] = []

  const rawMode = normalize(mode)
  let configured: RegistrationMode | undefined
  if (typeof rawMode === 'string') {
    if (isRegistrationMode(rawMode)) {
      configured = rawMode
    } else {
      configured = 'closed'
      warnings.push({
        code: 'invalid-mode',
        severity: 'error',
        message:
          'REGISTRATION_MODE is not a recognized value, so self-serve registration is closed until it is corrected. Existing accounts can still sign in.',
        details: { value: rawMode, allowed: REGISTRATION_MODES },
      })
    }
  }

  const setLegacy = (Object.keys(DEPRECATED_REGISTRATION_ENV_VARS) as LegacyRegistrationKey[])
    .filter((key) => normalize(legacy[key]) !== undefined)
    .map((key) => DEPRECATED_REGISTRATION_ENV_VARS[key])

  const legacyAxes: RegistrationAxes = {
    signup: isOn(legacy.disableRegistration)
      ? 'closed'
      : isOn(legacy.disableEmailSignup)
        ? 'no-email-signup'
        : 'open',
    emailAuth:
      !isOff(legacy.emailPasswordSignupEnabled) && !isOff(legacy.publicEmailPasswordSignupEnabled),
  }
  const legacyMode = modeFromAxes(legacyAxes)

  if (setLegacy.length > 0) {
    warnings.push({
      code: 'deprecated-variables',
      severity: 'warn',
      message:
        'Deprecated registration variables are set. Replace them with REGISTRATION_MODE; they still apply until removed.',
      details: { variables: setLegacy, equivalentMode: legacyMode },
    })
  }

  if (configured === undefined) return { mode: legacyMode, warnings }

  const resolved = modeFromAxes(mostRestrictive(MODE_AXES[configured], legacyAxes))
  if (resolved !== configured) {
    warnings.push({
      code: 'conflict',
      severity: 'warn',
      message:
        'Deprecated registration variables are more restrictive than REGISTRATION_MODE, so the most restrictive combination applies.',
      details: { configured, legacy: legacyMode, resolved },
    })
  }
  return { mode: resolved, warnings }
}

export function getRegistrationPolicy(mode: RegistrationMode): RegistrationPolicy {
  const { signup, emailAuth } = MODE_AXES[mode]
  return {
    selfServeRegistrationClosed: signup === 'closed',
    emailSignupAllowed: signup === 'open' && emailAuth,
    emailPasswordAuthEnabled: emailAuth,
  }
}
