import { vi } from 'vitest'

/** Stand-in for the real `KnowledgeSearchProvenanceUnavailableError` (real name and message). */
export class MockKnowledgeSearchProvenanceUnavailableError extends Error {
  constructor() {
    super('Knowledge result secret provenance is unavailable')
    this.name = 'KnowledgeSearchProvenanceUnavailableError'
  }
}

/**
 * Controllable mock functions for `@/lib/knowledge/application/search`.
 *
 * Defaults:
 * - `mockValidateKnowledgeSearchInput` is a no-op (the real one throws an `OrchestrationError`
 *   on out-of-policy input; set it per test to exercise that branch).
 * - `mockBuildKnowledgeSearchContext` returns `{ ...context, knowledgeBases, access: {} }`.
 * - `mockRunKnowledgeSearch`, `mockAfterKnowledgeSearch`, `mockSearchKnowledgeExecute` and
 *   `mockSearchKnowledgeAuthorize` are bare.
 *
 * @example
 * ```ts
 * import { knowledgeSearchUseCaseMockFns } from '@sim/testing/mocks/knowledge-search-use-case.mock'
 *
 * knowledgeSearchUseCaseMockFns.mockSearchKnowledgeExecute.mockResolvedValue({ results: [] })
 * ```
 */
export const knowledgeSearchUseCaseMockFns = {
  mockValidateKnowledgeSearchInput: vi.fn((_input: unknown): void => {}),
  mockBuildKnowledgeSearchContext: vi.fn(
    (_principal: unknown, context: unknown, knowledgeBases: unknown, _input?: unknown) => ({
      ...(context as Record<string, unknown>),
      knowledgeBases,
      access: {},
    })
  ),
  mockRunKnowledgeSearch: vi.fn(),
  mockAfterKnowledgeSearch: vi.fn(),
  mockSearchKnowledgeAuthorize: vi.fn(),
  mockSearchKnowledgeExecute: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/application/search`. `KNOWLEDGE_SEARCH_COST_POLICY`
 * carries the real values; `searchKnowledge` is `{ operation: { id: 'knowledge.search' },
 * authorize, execute }`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/application/search', () => knowledgeSearchUseCaseMock)
 * ```
 */
export const knowledgeSearchUseCaseMock = {
  KNOWLEDGE_SEARCH_COST_POLICY: { maxKnowledgeBases: 20, maxTopK: 100 } as const,
  KnowledgeSearchProvenanceUnavailableError: MockKnowledgeSearchProvenanceUnavailableError,
  validateKnowledgeSearchInput: knowledgeSearchUseCaseMockFns.mockValidateKnowledgeSearchInput,
  buildKnowledgeSearchContext: knowledgeSearchUseCaseMockFns.mockBuildKnowledgeSearchContext,
  runKnowledgeSearch: knowledgeSearchUseCaseMockFns.mockRunKnowledgeSearch,
  afterKnowledgeSearch: knowledgeSearchUseCaseMockFns.mockAfterKnowledgeSearch,
  searchKnowledge: {
    operation: { id: 'knowledge.search' },
    authorize: knowledgeSearchUseCaseMockFns.mockSearchKnowledgeAuthorize,
    execute: knowledgeSearchUseCaseMockFns.mockSearchKnowledgeExecute,
  },
}
