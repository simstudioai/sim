import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/knowledge/access/scope`. All are bare `vi.fn()`s; tests
 * return their own provider (`{ get, getForConnectors, ... }`) from the `create*` factories.
 *
 * @example
 * ```ts
 * import { knowledgeAccessScopeMockFns } from '@sim/testing/mocks/knowledge-access-scope.mock'
 *
 * knowledgeAccessScopeMockFns.mockCreateKnowledgeAccessProvider.mockReturnValue({ get: mockGet })
 * ```
 */
export const knowledgeAccessScopeMockFns = {
  mockResolveKnowledgeAccessScope: vi.fn(),
  mockResolveUserKnowledgeAccessScope: vi.fn(),
  mockCreateKnowledgeAccessProvider: vi.fn(),
  mockCreateUserKnowledgeAccessProvider: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/access/scope`. `WORKSPACE_ACCESS_SCOPE` carries the real
 * frozen value `{ kind: 'workspace', tokens: ['pub', 'ws'] }`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/access/scope', () => knowledgeAccessScopeMock)
 * ```
 */
export const knowledgeAccessScopeMock = {
  WORKSPACE_ACCESS_SCOPE: Object.freeze({
    kind: 'workspace' as const,
    tokens: ['pub', 'ws'] as const,
  }),
  resolveKnowledgeAccessScope: knowledgeAccessScopeMockFns.mockResolveKnowledgeAccessScope,
  resolveUserKnowledgeAccessScope: knowledgeAccessScopeMockFns.mockResolveUserKnowledgeAccessScope,
  createKnowledgeAccessProvider: knowledgeAccessScopeMockFns.mockCreateKnowledgeAccessProvider,
  createUserKnowledgeAccessProvider:
    knowledgeAccessScopeMockFns.mockCreateUserKnowledgeAccessProvider,
}
