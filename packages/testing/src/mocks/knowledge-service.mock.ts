import { vi } from 'vitest'

/** Stand-in for `KnowledgeBaseConflictError` (`code: 'conflict'`). NOT an `OrchestrationError`. */
export class MockKnowledgeBaseConflictError extends Error {
  readonly code = 'conflict' as const

  constructor(name: string) {
    super(
      `A knowledge base named "${name}" already exists in this workspace. Names are unique across the whole workspace — folders do not namespace them — so pick a different name, or rename/delete the existing knowledge base first.`
    )
    this.name = 'KnowledgeBaseConflictError'
  }
}

/** Stand-in for `KnowledgeBasePermissionError` (`code: 'forbidden'`). NOT an `OrchestrationError`. */
export class MockKnowledgeBasePermissionError extends Error {
  readonly code = 'forbidden' as const

  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeBasePermissionError'
  }
}

/** Stand-in for `KnowledgeBaseFolderError` (`code: 'validation'`). NOT an `OrchestrationError`. */
export class MockKnowledgeBaseFolderError extends Error {
  readonly code = 'validation' as const

  constructor() {
    super('Folder not found in this workspace')
    this.name = 'KnowledgeBaseFolderError'
  }
}

/** Stand-in for `KnowledgeBaseNotFoundError` (`code: 'not_found'`). NOT an `OrchestrationError`. */
export class MockKnowledgeBaseNotFoundError extends Error {
  readonly code = 'not_found' as const

  constructor(knowledgeBaseId: string) {
    super(`Knowledge base ${knowledgeBaseId} not found`)
    this.name = 'KnowledgeBaseNotFoundError'
  }
}

/**
 * Controllable mock functions for `@/lib/knowledge/service`. All are bare `vi.fn()`s.
 *
 * @example
 * ```ts
 * import { knowledgeServiceMockFns } from '@sim/testing/mocks/knowledge-service.mock'
 *
 * knowledgeServiceMockFns.mockGetKnowledgeBaseById.mockResolvedValue({ id: 'kb-1' })
 * ```
 */
export const knowledgeServiceMockFns = {
  mockGetWorkspaceKnowledgeBases: vi.fn(),
  mockFindActiveKnowledgeBasesByExactName: vi.fn(),
  mockCreateKnowledgeBase: vi.fn(),
  mockCreateAuthorizedKnowledgeBase: vi.fn(),
  mockUpdateKnowledgeBase: vi.fn(),
  mockGetKnowledgeBaseNames: vi.fn(),
  mockGetActiveKnowledgeBaseReference: vi.fn(),
  mockGetActiveKnowledgeBaseReferences: vi.fn(),
  mockGetKnowledgeBaseById: vi.fn(),
  mockAttachKnowledgeBaseConnectors: vi.fn(),
  mockDeleteKnowledgeBase: vi.fn(),
  mockRestoreKnowledgeBase: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/service`. Error classes are the `MockKnowledgeBase*Error`
 * stand-ins above.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)
 * ```
 */
export const knowledgeServiceMock = {
  KnowledgeBaseConflictError: MockKnowledgeBaseConflictError,
  KnowledgeBasePermissionError: MockKnowledgeBasePermissionError,
  KnowledgeBaseFolderError: MockKnowledgeBaseFolderError,
  KnowledgeBaseNotFoundError: MockKnowledgeBaseNotFoundError,
  getWorkspaceKnowledgeBases: knowledgeServiceMockFns.mockGetWorkspaceKnowledgeBases,
  findActiveKnowledgeBasesByExactName:
    knowledgeServiceMockFns.mockFindActiveKnowledgeBasesByExactName,
  createKnowledgeBase: knowledgeServiceMockFns.mockCreateKnowledgeBase,
  createAuthorizedKnowledgeBase: knowledgeServiceMockFns.mockCreateAuthorizedKnowledgeBase,
  updateKnowledgeBase: knowledgeServiceMockFns.mockUpdateKnowledgeBase,
  getKnowledgeBaseNames: knowledgeServiceMockFns.mockGetKnowledgeBaseNames,
  getActiveKnowledgeBaseReference: knowledgeServiceMockFns.mockGetActiveKnowledgeBaseReference,
  getActiveKnowledgeBaseReferences: knowledgeServiceMockFns.mockGetActiveKnowledgeBaseReferences,
  getKnowledgeBaseById: knowledgeServiceMockFns.mockGetKnowledgeBaseById,
  attachKnowledgeBaseConnectors: knowledgeServiceMockFns.mockAttachKnowledgeBaseConnectors,
  deleteKnowledgeBase: knowledgeServiceMockFns.mockDeleteKnowledgeBase,
  restoreKnowledgeBase: knowledgeServiceMockFns.mockRestoreKnowledgeBase,
}
