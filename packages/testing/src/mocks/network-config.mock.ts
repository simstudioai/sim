import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/network/config.server`.
 *
 * Defaults (the real result with no `OUTBOUND_ROUTING_SOURCE` configured):
 * - `mockIsOutboundRoutingEnabled` returns `false`.
 * - `mockResolveOutboundRoute` resolves `{ kind: 'direct' }`.
 * - `mockCreateOutboundRoutingReader` is bare.
 *
 * @example
 * ```ts
 * import { networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
 *
 * networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
 * networkConfigMockFns.mockResolveOutboundRoute.mockResolvedValue({ kind: 'gateway', gateway })
 * ```
 */
export const networkConfigMockFns = {
  mockCreateOutboundRoutingReader: vi.fn(),
  mockIsOutboundRoutingEnabled: vi.fn((): boolean => false),
  mockResolveOutboundRoute: vi.fn(
    async (_organizationId: string | null | undefined): Promise<unknown> => ({ kind: 'direct' })
  ),
}

/**
 * Static mock module for `@/lib/core/network/config.server`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/network/config.server', () => networkConfigMock)
 * ```
 */
export const networkConfigMock = {
  createOutboundRoutingReader: networkConfigMockFns.mockCreateOutboundRoutingReader,
  isOutboundRoutingEnabled: networkConfigMockFns.mockIsOutboundRoutingEnabled,
  resolveOutboundRoute: networkConfigMockFns.mockResolveOutboundRoute,
}
