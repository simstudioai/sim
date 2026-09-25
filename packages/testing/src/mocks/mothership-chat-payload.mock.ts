import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/chat/payload`.
 *
 * `mockBuildIntegrationToolSchemas` and `mockBuildCopilotRequestPayload` are bare;
 * `mockClearIntegrationToolSchemaCacheForTests` is a no-op.
 *
 * @example
 * ```ts
 * import { mothershipChatPayloadMockFns } from '@sim/testing/mocks/mothership-chat-payload.mock'
 *
 * mothershipChatPayloadMockFns.mockBuildIntegrationToolSchemas.mockResolvedValue([])
 * ```
 */
export const mothershipChatPayloadMockFns = {
  mockClearIntegrationToolSchemaCacheForTests: vi.fn((): void => {}),
  mockBuildIntegrationToolSchemas: vi.fn(),
  mockBuildCopilotRequestPayload: vi.fn(),
}

/**
 * Static mock module for `@/lib/mothership/chat/payload`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/chat/payload', () => mothershipChatPayloadMock)
 * ```
 */
export const mothershipChatPayloadMock = {
  clearIntegrationToolSchemaCacheForTests:
    mothershipChatPayloadMockFns.mockClearIntegrationToolSchemaCacheForTests,
  buildIntegrationToolSchemas: mothershipChatPayloadMockFns.mockBuildIntegrationToolSchemas,
  buildCopilotRequestPayload: mothershipChatPayloadMockFns.mockBuildCopilotRequestPayload,
}
