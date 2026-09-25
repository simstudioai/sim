import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/knowledge/application/knowledge-bases`. Every use case
 * gets `mock<UseCase>Execute`; the authorizing (workspace/organization) ones also get
 * `mock<UseCase>Authorize`. All are bare `vi.fn()`s.
 *
 * @example
 * ```ts
 * import { knowledgeBaseUseCasesMockFns } from '@sim/testing/mocks/knowledge-base-use-cases.mock'
 *
 * knowledgeBaseUseCasesMockFns.mockListKnowledgeBasesExecute.mockResolvedValue([])
 * ```
 */
export const knowledgeBaseUseCasesMockFns = {
  mockListKnowledgeBasesAuthorize: vi.fn(),
  mockListKnowledgeBasesExecute: vi.fn(),
  mockListKnowledgeBaseCatalogAuthorize: vi.fn(),
  mockListKnowledgeBaseCatalogExecute: vi.fn(),
  mockRestoreKnowledgeBaseAuthorize: vi.fn(),
  mockRestoreKnowledgeBaseExecute: vi.fn(),
  mockCreateKnowledgeBaseAuthorize: vi.fn(),
  mockCreateKnowledgeBaseExecute: vi.fn(),
  mockReadKnowledgeBaseAuthorize: vi.fn(),
  mockReadKnowledgeBaseExecute: vi.fn(),
  mockUpdateKnowledgeBaseOperationAuthorize: vi.fn(),
  mockUpdateKnowledgeBaseOperationExecute: vi.fn(),
  mockDeleteKnowledgeBaseOperationAuthorize: vi.fn(),
  mockDeleteKnowledgeBaseOperationExecute: vi.fn(),
  mockBulkDeleteKnowledgeBasesAuthorize: vi.fn(),
  mockBulkDeleteKnowledgeBasesExecute: vi.fn(),
  mockListInternalKnowledgeBasesExecute: vi.fn(),
  mockReadInternalKnowledgeBaseExecute: vi.fn(),
  mockUpdateInternalKnowledgeBaseExecute: vi.fn(),
  mockDeleteInternalKnowledgeBaseExecute: vi.fn(),
  mockRestoreInternalKnowledgeBaseExecute: vi.fn(),
}

const fns = knowledgeBaseUseCasesMockFns

/**
 * Static mock module for `@/lib/knowledge/application/knowledge-bases`. Each use case is
 * `{ operation: { id }, authorize?, execute }` with the real operation id.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/application/knowledge-bases', () => knowledgeBaseUseCasesMock)
 * ```
 */
export const knowledgeBaseUseCasesMock = {
  listKnowledgeBases: {
    operation: { id: 'knowledge.list' },
    authorize: fns.mockListKnowledgeBasesAuthorize,
    execute: fns.mockListKnowledgeBasesExecute,
  },
  listKnowledgeBaseCatalog: {
    operation: { id: 'knowledge.list' },
    authorize: fns.mockListKnowledgeBaseCatalogAuthorize,
    execute: fns.mockListKnowledgeBaseCatalogExecute,
  },
  restoreKnowledgeBase: {
    operation: { id: 'knowledge.restore' },
    authorize: fns.mockRestoreKnowledgeBaseAuthorize,
    execute: fns.mockRestoreKnowledgeBaseExecute,
  },
  createKnowledgeBase: {
    operation: { id: 'knowledge.create' },
    authorize: fns.mockCreateKnowledgeBaseAuthorize,
    execute: fns.mockCreateKnowledgeBaseExecute,
  },
  readKnowledgeBase: {
    operation: { id: 'knowledge.read' },
    authorize: fns.mockReadKnowledgeBaseAuthorize,
    execute: fns.mockReadKnowledgeBaseExecute,
  },
  updateKnowledgeBaseOperation: {
    operation: { id: 'knowledge.update' },
    authorize: fns.mockUpdateKnowledgeBaseOperationAuthorize,
    execute: fns.mockUpdateKnowledgeBaseOperationExecute,
  },
  deleteKnowledgeBaseOperation: {
    operation: { id: 'knowledge.delete' },
    authorize: fns.mockDeleteKnowledgeBaseOperationAuthorize,
    execute: fns.mockDeleteKnowledgeBaseOperationExecute,
  },
  bulkDeleteKnowledgeBases: {
    operation: { id: 'knowledge.bulk_delete' },
    authorize: fns.mockBulkDeleteKnowledgeBasesAuthorize,
    execute: fns.mockBulkDeleteKnowledgeBasesExecute,
  },
  listInternalKnowledgeBases: {
    operation: { id: 'knowledge.session.list' },
    execute: fns.mockListInternalKnowledgeBasesExecute,
  },
  readInternalKnowledgeBase: {
    operation: { id: 'knowledge.session.read' },
    execute: fns.mockReadInternalKnowledgeBaseExecute,
  },
  updateInternalKnowledgeBase: {
    operation: { id: 'knowledge.session.update' },
    execute: fns.mockUpdateInternalKnowledgeBaseExecute,
  },
  deleteInternalKnowledgeBase: {
    operation: { id: 'knowledge.session.delete' },
    execute: fns.mockDeleteInternalKnowledgeBaseExecute,
  },
  restoreInternalKnowledgeBase: {
    operation: { id: 'knowledge.session.restore' },
    execute: fns.mockRestoreInternalKnowledgeBaseExecute,
  },
}
