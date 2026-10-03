import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/knowledge/connectors/member-queue`. All are bare `vi.fn()`s.
 *
 * @example
 * ```ts
 * import { knowledgeMemberQueueMockFns } from '@sim/testing/mocks/knowledge-member-queue.mock'
 *
 * expect(knowledgeMemberQueueMockFns.mockDispatchMemberSync).toHaveBeenCalled()
 * ```
 */
export const knowledgeMemberQueueMockFns = {
  mockAssertMemberSyncPayload: vi.fn(),
  mockDispatchMemberSync: vi.fn(),
  mockDispatchMemberSyncsForCredentialOption: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/connectors/member-queue`. Constants carry the real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/connectors/member-queue', () => knowledgeMemberQueueMock)
 * ```
 */
export const knowledgeMemberQueueMock = {
  MEMBER_SYNC_TASK_ID: 'knowledge-connector-member-sync',
  QUEUEABLE_MEMBER_SYNC_STATUSES: ['idle', 'error'] as const,
  assertMemberSyncPayload: knowledgeMemberQueueMockFns.mockAssertMemberSyncPayload,
  dispatchMemberSync: knowledgeMemberQueueMockFns.mockDispatchMemberSync,
  dispatchMemberSyncsForCredentialOption:
    knowledgeMemberQueueMockFns.mockDispatchMemberSyncsForCredentialOption,
}
