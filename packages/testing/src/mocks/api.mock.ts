/**
 * Mock utilities for API testing
 */
import { vi } from 'vitest'
import { createMockLogger } from './logger.mock'

/**
 * Mock drizzle-orm operators for database query testing.
 * Provides mock implementations of common drizzle-orm operators.
 *
 * @example
 * ```ts
 * mockDrizzleOrm()
 * // Now eq, and, or, etc. from drizzle-orm are mocked
 * ```
 */
export function mockDrizzleOrm() {
  vi.doMock('drizzle-orm', () => ({
    and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
    eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    or: vi.fn((...conditions) => ({ type: 'or', conditions })),
    gte: vi.fn((field, value) => ({ type: 'gte', field, value })),
    lte: vi.fn((field, value) => ({ type: 'lte', field, value })),
    gt: vi.fn((field, value) => ({ type: 'gt', field, value })),
    lt: vi.fn((field, value) => ({ type: 'lt', field, value })),
    ne: vi.fn((field, value) => ({ type: 'ne', field, value })),
    asc: vi.fn((field) => ({ field, type: 'asc' })),
    desc: vi.fn((field) => ({ field, type: 'desc' })),
    isNull: vi.fn((field) => ({ field, type: 'isNull' })),
    isNotNull: vi.fn((field) => ({ field, type: 'isNotNull' })),
    inArray: vi.fn((field, values) => ({ field, values, type: 'inArray' })),
    notInArray: vi.fn((field, values) => ({ field, values, type: 'notInArray' })),
    like: vi.fn((field, value) => ({ field, value, type: 'like' })),
    ilike: vi.fn((field, value) => ({ field, value, type: 'ilike' })),
    count: vi.fn((field) => ({ field, type: 'count' })),
    sum: vi.fn((field) => ({ field, type: 'sum' })),
    avg: vi.fn((field) => ({ field, type: 'avg' })),
    min: vi.fn((field) => ({ field, type: 'min' })),
    max: vi.fn((field) => ({ field, type: 'max' })),
    sql: vi.fn((strings, ...values) => ({
      type: 'sql',
      sql: strings,
      values,
    })),
  }))
}

/**
 * Mock common database schema patterns.
 * Provides mock schema objects for common tables.
 *
 * @example
 * ```ts
 * mockCommonSchemas()
 * // Now @sim/db/schema exports are mocked
 * ```
 */
export function mockCommonSchemas() {
  vi.doMock('@sim/db/schema', () => ({
    workflowFolder: {
      id: 'id',
      userId: 'userId',
      parentId: 'parentId',
      updatedAt: 'updatedAt',
      workspaceId: 'workspaceId',
      sortOrder: 'sortOrder',
      createdAt: 'createdAt',
    },
    workflow: {
      id: 'id',
      folderId: 'folderId',
      userId: 'userId',
      updatedAt: 'updatedAt',
    },
    account: {
      userId: 'userId',
      providerId: 'providerId',
    },
    user: {
      email: 'email',
      id: 'id',
    },
  }))
}

/**
 * Mock console logger using the shared mock logger.
 * Ensures tests can assert on logger calls.
 *
 * @example
 * ```ts
 * mockConsoleLogger()
 * // Now @sim/logger.createLogger returns a mock logger
 * ```
 */
export function mockConsoleLogger() {
  const mockLogger = createMockLogger()
  vi.doMock('@sim/logger', () => ({
    createLogger: vi.fn().mockReturnValue(mockLogger),
  }))
  return mockLogger
}

/**
 * Setup common API test mocks (schemas, drizzle ORM).
 * Does NOT set up logger mocks - call mockConsoleLogger() separately if needed.
 *
 * @example
 * ```ts
 * setupCommonApiMocks()
 * const mockLogger = mockConsoleLogger() // Call separately to get logger instance
 * ```
 */
export function setupCommonApiMocks() {
  mockCommonSchemas()
  mockDrizzleOrm()
}

/**
 * Mock knowledge-related database schemas.
 * Provides mock schema objects for knowledge base tables.
 *
 * @example
 * ```ts
 * mockKnowledgeSchemas()
 * // Now @sim/db/schema exports knowledge base tables
 * ```
 */
export function mockKnowledgeSchemas() {
  vi.doMock('@sim/db/schema', () => ({
    knowledgeBase: {
      id: 'kb_id',
      userId: 'user_id',
      name: 'kb_name',
      description: 'description',
      tokenCount: 'token_count',
      embeddingModel: 'embedding_model',
      embeddingDimension: 'embedding_dimension',
      chunkingConfig: 'chunking_config',
      workspaceId: 'workspace_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
    },
    document: {
      id: 'doc_id',
      knowledgeBaseId: 'kb_id',
      filename: 'filename',
      fileUrl: 'file_url',
      fileSize: 'file_size',
      mimeType: 'mime_type',
      chunkCount: 'chunk_count',
      tokenCount: 'token_count',
      characterCount: 'character_count',
      processingStatus: 'processing_status',
      processingStartedAt: 'processing_started_at',
      processingCompletedAt: 'processing_completed_at',
      processingError: 'processing_error',
      enabled: 'enabled',
      tag1: 'tag1',
      tag2: 'tag2',
      tag3: 'tag3',
      tag4: 'tag4',
      tag5: 'tag5',
      tag6: 'tag6',
      tag7: 'tag7',
      uploadedAt: 'uploaded_at',
      deletedAt: 'deleted_at',
    },
    embedding: {
      id: 'embedding_id',
      documentId: 'doc_id',
      knowledgeBaseId: 'kb_id',
      chunkIndex: 'chunk_index',
      content: 'content',
      embedding: 'embedding',
      tokenCount: 'token_count',
      characterCount: 'character_count',
      tag1: 'tag1',
      tag2: 'tag2',
      tag3: 'tag3',
      tag4: 'tag4',
      tag5: 'tag5',
      tag6: 'tag6',
      tag7: 'tag7',
      createdAt: 'created_at',
    },
    permissions: {
      id: 'permission_id',
      userId: 'user_id',
      entityType: 'entity_type',
      entityId: 'entity_id',
      permissionType: 'permission_type',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }))
}
