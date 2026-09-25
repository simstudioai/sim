import { vi } from 'vitest'

/**
 * Stand-in for `KnowledgeTagProvenanceConflictError` (`code: 'conflict'`). NOT an
 * `OrchestrationError`.
 */
export class MockKnowledgeTagProvenanceConflictError extends Error {
  readonly code = 'conflict' as const

  constructor() {
    super('Tag definitions cannot be deleted while resolved-secret document provenance is present')
    this.name = 'KnowledgeTagProvenanceConflictError'
  }
}

const mockGetDocumentTagDefinitions = vi.fn()

/**
 * Controllable mock functions for `@/lib/knowledge/tags/service`.
 *
 * Defaults:
 * - `mockNormalizeDisplayName` is the real `trim().toLowerCase()`.
 * - `mockGetDocumentTagDefinitionsByKnowledgeBaseIds` resolves a `Map` of each id to
 *   `await mockGetDocumentTagDefinitions(id)`, so a test stubbing the per-base read drives both.
 * - Everything else is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { knowledgeTagsServiceMockFns } from '@sim/testing/mocks/knowledge-tags-service.mock'
 *
 * knowledgeTagsServiceMockFns.mockGetDocumentTagDefinitions.mockResolvedValue([])
 * ```
 */
export const knowledgeTagsServiceMockFns = {
  mockGetNextAvailableSlot: vi.fn(),
  mockGetDocumentTagDefinitions,
  mockGetDocumentTagDefinitionsByKnowledgeBaseIds: vi.fn(
    async (knowledgeBaseIds: readonly string[]): Promise<Map<string, unknown>> =>
      new Map(
        await Promise.all(
          knowledgeBaseIds.map(
            async (id): Promise<[string, unknown]> => [id, await mockGetDocumentTagDefinitions(id)]
          )
        )
      )
  ),
  mockGetTagDefinitions: vi.fn(),
  mockNormalizeDisplayName: vi.fn((displayName: string): string =>
    displayName.trim().toLowerCase()
  ),
  mockCreateOrUpdateTagDefinitionsBulk: vi.fn(),
  mockGetTagDefinitionById: vi.fn(),
  mockCleanupUnusedTagDefinitions: vi.fn(),
  mockDeleteAllTagDefinitions: vi.fn(),
  mockDeleteTagDefinition: vi.fn(),
  mockCreateTagDefinition: vi.fn(),
  mockUpdateTagDefinition: vi.fn(),
  mockGetTagUsage: vi.fn(),
  mockGetTagUsageStats: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/tags/service`. The error class is
 * {@link MockKnowledgeTagProvenanceConflictError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/tags/service', () => knowledgeTagsServiceMock)
 * ```
 */
export const knowledgeTagsServiceMock = {
  KnowledgeTagProvenanceConflictError: MockKnowledgeTagProvenanceConflictError,
  getNextAvailableSlot: knowledgeTagsServiceMockFns.mockGetNextAvailableSlot,
  getDocumentTagDefinitions: knowledgeTagsServiceMockFns.mockGetDocumentTagDefinitions,
  getDocumentTagDefinitionsByKnowledgeBaseIds:
    knowledgeTagsServiceMockFns.mockGetDocumentTagDefinitionsByKnowledgeBaseIds,
  getTagDefinitions: knowledgeTagsServiceMockFns.mockGetTagDefinitions,
  normalizeDisplayName: knowledgeTagsServiceMockFns.mockNormalizeDisplayName,
  createOrUpdateTagDefinitionsBulk:
    knowledgeTagsServiceMockFns.mockCreateOrUpdateTagDefinitionsBulk,
  getTagDefinitionById: knowledgeTagsServiceMockFns.mockGetTagDefinitionById,
  cleanupUnusedTagDefinitions: knowledgeTagsServiceMockFns.mockCleanupUnusedTagDefinitions,
  deleteAllTagDefinitions: knowledgeTagsServiceMockFns.mockDeleteAllTagDefinitions,
  deleteTagDefinition: knowledgeTagsServiceMockFns.mockDeleteTagDefinition,
  createTagDefinition: knowledgeTagsServiceMockFns.mockCreateTagDefinition,
  updateTagDefinition: knowledgeTagsServiceMockFns.mockUpdateTagDefinition,
  getTagUsage: knowledgeTagsServiceMockFns.mockGetTagUsage,
  getTagUsageStats: knowledgeTagsServiceMockFns.mockGetTagUsageStats,
}
