import { vi } from 'vitest'

/**
 * Default mock environment values for testing
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
 * Creates a mock getEnv function that returns values from the provided env object
 */
export function createMockGetEnv(envValues: Record<string, string | undefined> = defaultMockEnv) {
  return vi.fn((key: string) => envValues[key])
}

/**
 * Creates a complete env mock object for use with vi.doMock
 *
 * @example
 * ```ts
 * vi.doMock('@/lib/core/config/env', () => createEnvMock())
 *
 * // With custom values
 * vi.doMock('@/lib/core/config/env', () => createEnvMock({
 *   NEXT_PUBLIC_APP_URL: 'https://custom.example.com',
 * }))
 * ```
 */
export function createEnvMock(overrides: Record<string, string | undefined> = {}) {
  const envValues = { ...defaultMockEnv, ...overrides }

  return {
    env: envValues,
    getEnv: createMockGetEnv(envValues),
    isTruthy: (value: string | boolean | number | undefined) =>
      typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value),
    isFalsy: (value: string | boolean | number | undefined) =>
      typeof value === 'string'
        ? value.toLowerCase() === 'false' || value === '0'
        : value === false,
  }
}

/**
 * Pre-configured env mock for direct use with vi.mock
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/env', () => envMock)
 * ```
 */
export const envMock = createEnvMock()
