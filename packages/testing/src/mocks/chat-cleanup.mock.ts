import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/cleanup/chat-cleanup`.
 *
 * `prepareChatCleanup` resolves a handle whose `execute` is `mockExecuteChatCleanup`, so a test
 * can assert both that the cleanup was prepared for the right chats and that it ran. The backend
 * and storage calls resolve to zero counts, and no organization attachment is still referenced.
 *
 * @example
 * ```ts
 * import { chatCleanupMock, chatCleanupMockFns } from '@sim/testing/mocks/chat-cleanup.mock'
 *
 * vi.mock('@/lib/cleanup/chat-cleanup', () => chatCleanupMock)
 * expect(chatCleanupMockFns.mockPrepareChatCleanup).toHaveBeenCalledWith(['chat-1'], 'label')
 * ```
 */
export const chatCleanupMockFns = {
  mockExecuteChatCleanup: vi.fn(async () => {}),
  mockPrepareChatCleanup: vi.fn(async (_chatIds: string[], _label: string) => ({
    execute: chatCleanupMockFns.mockExecuteChatCleanup,
  })),
  mockCleanupCopilotBackend: vi.fn(async (_chatIds: string[], _label: string) => ({
    deleted: 0,
    failed: 0,
  })),
  mockDeleteStorageFiles: vi.fn(async (_files: unknown[], _label: string) => ({
    filesDeleted: 0,
    filesFailed: 0,
  })),
  mockOrganizationAttachmentsStillReferenced: vi.fn(async (_files: unknown[]) => new Set<string>()),
}

/** Stand-in for `@/lib/cleanup/chat-cleanup`; every runtime export of the real module. */
export const chatCleanupMock = {
  prepareChatCleanup: chatCleanupMockFns.mockPrepareChatCleanup,
  cleanupCopilotBackend: chatCleanupMockFns.mockCleanupCopilotBackend,
  deleteStorageFiles: chatCleanupMockFns.mockDeleteStorageFiles,
  organizationAttachmentsStillReferenced:
    chatCleanupMockFns.mockOrganizationAttachmentsStillReferenced,
}
