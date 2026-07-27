import { vi } from 'vitest'

/**
 * Value type for entries in the mocked env object. The real module runs
 * `createEnv` with `skipValidation: true`, so values arrive as raw strings
 * (or occasionally booleans/numbers when injected programmatically).
 */
export type EnvMockValue = string | boolean | number | undefined

/**
 * Default mock environment values for testing. These seed the shared stateful
 * env mock and are restored by {@link resetEnvMock}.
 */
export const defaultMockEnv = {
  // Core
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  BETTER_AUTH_URL: 'https://test.sim.ai',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-chars-long',
  ENCRYPTION_KEY: 'test-encryption-key-32-chars-long!',
  INTERNAL_API_SECRET: 'test-internal-api-secret-32-chars!',

  // Email
  RESEND_API_KEY: 'test-resend-key',
  FROM_EMAIL_ADDRESS: 'Sim <noreply@test.sim.ai>',
  EMAIL_DOMAIN: 'test.sim.ai',
  PERSONAL_EMAIL_FROM: 'Test <test@test.sim.ai>',

  // URLs
  NEXT_PUBLIC_APP_URL: 'https://test.sim.ai',
}

/**
 * Mutable state backing the shared env mock. Keys present here (even with an
 * `undefined` value) shadow `process.env`; absent keys fall back to
 * `process.env` so `vi.stubEnv`-driven tests keep working for variables the
 * defaults do not pin.
 */
const envState: Record<string, EnvMockValue> = { ...defaultMockEnv }

function readEnvValue(key: string): EnvMockValue {
  if (Object.hasOwn(envState, key)) return envState[key]
  return process.env[key]
}

/**
 * Live env object for the shared `@/lib/core/config/env` mock. Property reads
 * resolve against the mutable mock state first and `process.env` second;
 * property writes land in the mock state (mirroring how tests mutate the real
 * t3-env object under `skipValidation`).
 */
export const mockEnvObject: Record<string, EnvMockValue> = new Proxy(envState, {
  get: (_target, prop) => (typeof prop === 'string' ? readEnvValue(prop) : undefined),
  set: (target, prop, value) => {
    if (typeof prop === 'string') target[prop] = value as EnvMockValue
    return true
  },
  has: (target, prop) =>
    typeof prop === 'string' ? Object.hasOwn(target, prop) || prop in process.env : false,
  deleteProperty: (target, prop) => {
    if (typeof prop === 'string') delete target[prop]
    return true
  },
  ownKeys: (target) => Array.from(new Set([...Object.keys(target), ...Object.keys(process.env)])),
  getOwnPropertyDescriptor: (_target, prop) =>
    typeof prop === 'string'
      ? { enumerable: true, configurable: true, value: readEnvValue(prop) }
      : undefined,
})

/**
 * Applies per-test overrides to the shared env mock state. Passing an
 * explicitly `undefined` value pins the variable as unset (it will NOT fall
 * back to `process.env`).
 *
 * @example
 * ```ts
 * beforeEach(() => {
 *   setEnv({ REDIS_URL: 'redis://localhost:6379', NEXT_PUBLIC_APP_URL: undefined })
 * })
 * afterAll(resetEnvMock)
 * ```
 */
export function setEnv(overrides: Record<string, EnvMockValue>): void {
  Object.assign(envState, overrides)
}

/**
 * Restores the shared env mock to {@link defaultMockEnv} and reinstalls the
 * default `getEnv` implementation.
 */
export function resetEnvMock(): void {
  for (const key of Object.keys(envState)) delete envState[key]
  Object.assign(envState, defaultMockEnv)
  envMockFns.getEnv.mockReset().mockImplementation(getEnvDefaultImpl)
}

function getEnvDefaultImpl(variable: string): string | undefined {
  const value = readEnvValue(variable)
  return value === undefined ? undefined : String(value)
}

/** Mirrors the real `isTruthy` from `@/lib/core/config/env`. */
export const isTruthyImpl = (value: string | boolean | number | undefined): boolean =>
  typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value)

/** Mirrors the real `isFalsy` from `@/lib/core/config/env`. */
export const isFalsyImpl = (value: string | boolean | number | undefined): boolean =>
  typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false

/** Mirrors the real `envBoolean` from `@/lib/core/config/env`. */
export function envBooleanImpl(value: boolean | string | undefined | null): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

/** Mirrors the real `envNumber` from `@/lib/core/config/env`. */
export function envNumberImpl(
  value: number | string | undefined | null,
  fallback: number,
  options: { min?: number; integer?: boolean } = {}
): number {
  const min = options.min ?? 0
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    (!options.integer || Number.isInteger(value))
  ) {
    return value
  }
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && (!options.integer || Number.isInteger(parsed))
    ? parsed
    : fallback
}

/**
 * Controllable mock functions for the function exports of
 * `@/lib/core/config/env`. `getEnv` defaults to reading the shared state (with
 * `process.env` fallback); override per-test if needed. {@link resetEnvMock}
 * restores the default implementation.
 */
export const envMockFns = {
  getEnv: vi.fn<(variable: string) => string | undefined>(getEnvDefaultImpl),
}

/**
 * Creates a mock getEnv function that returns values from the provided env object.
 */
export function createMockGetEnv(envValues: Record<string, string | undefined> = defaultMockEnv) {
  return vi.fn((key: string) => envValues[key])
}

/**
 * Creates a standalone (non-shared) env mock module, for file-local factories
 * that need a fully isolated env rather than the shared stateful mock.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/env', () => createEnvMock({ REDIS_URL: 'redis://localhost:6379' }))
 * ```
 */
export function createEnvMock(overrides: Record<string, string | undefined> = {}) {
  const envValues = { ...defaultMockEnv, ...overrides }

  return {
    env: envValues,
    getEnv: createMockGetEnv(envValues),
    isTruthy: isTruthyImpl,
    isFalsy: isFalsyImpl,
    envBoolean: envBooleanImpl,
    envNumber: envNumberImpl,
  }
}

/**
 * Complete, stateful mock module for `@/lib/core/config/env`, installed
 * globally in `apps/sim/vitest.setup.ts`. Every export of the real module is
 * present. Reads through `env` and `getEnv` are live: override via
 * {@link setEnv} (or direct property assignment on `envMock.env`) and restore
 * with {@link resetEnvMock}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/env', () => envMock)
 * ```
 */
export const envMock = {
  env: mockEnvObject,
  getEnv: envMockFns.getEnv,
  isTruthy: isTruthyImpl,
  isFalsy: isFalsyImpl,
  envBoolean: envBooleanImpl,
  envNumber: envNumberImpl,
}
