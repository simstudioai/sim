import { vi } from 'vitest'

/**
 * Static mock module for `@/blocks/integration-matcher` that knows no integrations, so tests never
 * load the block registry: the matcher has no regex and `mentionifyIntegrations` returns its input.
 *
 * @example
 * ```ts
 * import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
 *
 * vi.mock('@/blocks/integration-matcher', () => integrationMatcherMock)
 * ```
 */
export const integrationMatcherMock = {
  getIntegrationMatcher: vi.fn(() => ({ regex: null, byName: new Map() })),
  mentionifyIntegrations: vi.fn((text: string) => text),
}
