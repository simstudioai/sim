import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/app/api/knowledge/utils`.
 * All defaults are bare `vi.fn()` — override per-test with
 * `knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseAccess.mockResolvedValueOnce(...)`.
 *
 * @example
 * ```ts
 * import { knowledgeApiUtilsMockFns } from '@sim/testing'
 *
 * knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseAccess.mockResolvedValue({
 *   hasAccess: true,
 *   knowledgeBase: { id: 'kb-1', userId: 'u-1', workspaceId: 'ws-1', name: 'KB' },
 * })
 * ```
 */
export const knowledgeApiUtilsMockFns = {
  mockCheckKnowledgeBaseAccess: vi.fn(),
  mockCheckKnowledgeBaseWriteAccess: vi.fn(),
  mockCheckDocumentWriteAccess: vi.fn(),
  mockCheckDocumentAccess: vi.fn(),
  mockCheckChunkAccess: vi.fn(),
}

/**
 * Static mock module for `@/app/api/knowledge/utils`.
 *
 * @example
 * ```ts
 * vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)
 * ```
 */
export const knowledgeApiUtilsMock = {
  checkKnowledgeBaseAccess: knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseAccess,
  checkKnowledgeBaseWriteAccess: knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseWriteAccess,
  checkDocumentWriteAccess: knowledgeApiUtilsMockFns.mockCheckDocumentWriteAccess,
  checkDocumentAccess: knowledgeApiUtilsMockFns.mockCheckDocumentAccess,
  checkChunkAccess: knowledgeApiUtilsMockFns.mockCheckChunkAccess,
}
