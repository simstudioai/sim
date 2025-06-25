import { NextRequest } from 'next/server'
import { vi } from 'vitest'

export interface MockUser {
  id: string
  email: string
  name?: string
}

export interface MockAuthResult {
  mockGetSession: ReturnType<typeof vi.fn>
  mockAuthenticatedUser: (user?: MockUser) => void
  mockUnauthenticated: () => void
  setAuthenticated: (user?: MockUser) => void
  setUnauthenticated: () => void
}

export interface DatabaseSelectResult {
  id: string
  [key: string]: any
}

export interface DatabaseInsertResult {
  id: string
  [key: string]: any
}

export interface DatabaseUpdateResult {
  id: string
  updatedAt?: Date
  [key: string]: any
}

export interface DatabaseDeleteResult {
  id: string
  [key: string]: any
}

export interface MockDatabaseOptions {
  select?: {
    results?: any[][]
    throwError?: boolean
    errorMessage?: string
  }
  insert?: {
    results?: any[]
    throwError?: boolean
    errorMessage?: string
  }
  update?: {
    results?: any[]
    throwError?: boolean
    errorMessage?: string
  }
  delete?: {
    results?: any[]
    throwError?: boolean
    errorMessage?: string
  }
  transaction?: {
    throwError?: boolean
    errorMessage?: string
  }
}

export interface CapturedFolderValues {
  name?: string
  color?: string
  parentId?: string | null
  isExpanded?: boolean
  sortOrder?: number
  updatedAt?: Date
}

export interface CapturedWorkflowValues {
  name?: string
  description?: string
  color?: string
  folderId?: string | null
  state?: any
  updatedAt?: Date
}

export const sampleWorkflowState = {
  blocks: {
    'starter-id': {
      id: 'starter-id',
      type: 'starter',
      name: 'Start',
      position: { x: 100, y: 100 },
      subBlocks: {
        startWorkflow: { id: 'startWorkflow', type: 'dropdown', value: 'manual' },
        webhookPath: { id: 'webhookPath', type: 'short-input', value: '' },
      },
      outputs: {
        response: { type: { input: 'any' } },
      },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 95,
    },
    'agent-id': {
      id: 'agent-id',
      type: 'agent',
      name: 'Agent 1',
      position: { x: 634, y: -167 },
      subBlocks: {
        systemPrompt: {
          id: 'systemPrompt',
          type: 'long-input',
          value: 'You are a helpful assistant',
        },
        context: { id: 'context', type: 'short-input', value: '<start.response.input>' },
        model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
        apiKey: { id: 'apiKey', type: 'short-input', value: '{{OPENAI_API_KEY}}' },
      },
      outputs: {
        response: {
          content: 'string',
          model: 'string',
          tokens: 'any',
        },
      },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 680,
    },
  },
  edges: [
    {
      id: 'edge-id',
      source: 'starter-id',
      target: 'agent-id',
      sourceHandle: 'source',
      targetHandle: 'target',
    },
  ],
  loops: {},
  lastSaved: Date.now(),
  isDeployed: false,
}

export const mockDb = {
  select: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockImplementation(() => [
          {
            id: 'workflow-id',
            userId: 'user-id',
            state: sampleWorkflowState,
          },
        ]),
      })),
    })),
  })),
  update: vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
  })),
  eq: vi.fn().mockImplementation((field, value) => ({ field, value, type: 'eq' })),
  and: vi.fn().mockImplementation((...conditions) => ({
    conditions,
    type: 'and',
  })),
}

export const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

export const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
}

export const mockSubscription = {
  id: 'sub-123',
  plan: 'enterprise',
  status: 'active',
  seats: 5,
  referenceId: 'user-123',
  metadata: {
    perSeatAllowance: 100,
    totalAllowance: 500,
    updatedAt: '2023-01-01T00:00:00.000Z',
  },
}

export const mockOrganization = {
  id: 'org-456',
  name: 'Test Organization',
  slug: 'test-org',
}

export const mockAdminMember = {
  id: 'member-123',
  userId: 'user-123',
  organizationId: 'org-456',
  role: 'admin',
}

export const mockRegularMember = {
  id: 'member-456',
  userId: 'user-123',
  organizationId: 'org-456',
  role: 'member',
}

export const mockTeamSubscription = {
  id: 'sub-456',
  plan: 'team',
  status: 'active',
  seats: 5,
  referenceId: 'org-123',
}

export const mockPersonalSubscription = {
  id: 'sub-789',
  plan: 'enterprise',
  status: 'active',
  seats: 5,
  referenceId: 'user-123',
  metadata: {
    perSeatAllowance: 100,
    totalAllowance: 500,
    updatedAt: '2023-01-01T00:00:00.000Z',
  },
}

export const mockEnvironmentVars = {
  OPENAI_API_KEY: 'encrypted:openai-api-key',
  SERPER_API_KEY: 'encrypted:serper-api-key',
}

export const mockDecryptedEnvVars = {
  OPENAI_API_KEY: 'sk-test123',
  SERPER_API_KEY: 'serper-test123',
}

export function createMockRequest(
  method = 'GET',
  body?: any,
  headers: Record<string, string> = {}
): NextRequest {
  const url = 'http://localhost:3000/api/test'

  return new NextRequest(new URL(url), {
    method,
    headers: new Headers(headers),
    body: body ? JSON.stringify(body) : undefined,
  })
}

export function mockExecutionDependencies() {
  vi.mock('@/lib/utils', async () => {
    const actual = await vi.importActual('@/lib/utils')
    return {
      ...(actual as any),
      decryptSecret: vi.fn().mockImplementation((encrypted: string) => {
        const entries = Object.entries(mockEnvironmentVars)
        const found = entries.find(([_, val]) => val === encrypted)
        const key = found ? found[0] : null

        return Promise.resolve({
          decrypted:
            key && key in mockDecryptedEnvVars
              ? mockDecryptedEnvVars[key as keyof typeof mockDecryptedEnvVars]
              : 'decrypted-value',
        })
      }),
    }
  })

  vi.mock('@/lib/logs/execution-logger', () => ({
    persistExecutionLogs: vi.fn().mockResolvedValue(undefined),
    persistExecutionError: vi.fn().mockResolvedValue(undefined),
  }))

  vi.mock('@/lib/logs/trace-spans', () => ({
    buildTraceSpans: vi.fn().mockReturnValue({
      traceSpans: [],
      totalDuration: 100,
    }),
  }))

  vi.mock('@/lib/workflows/utils', () => ({
    updateWorkflowRunCounts: vi.fn().mockResolvedValue(undefined),
  }))

  vi.mock('@/serializer', () => ({
    Serializer: vi.fn().mockImplementation(() => ({
      serializeWorkflow: vi.fn().mockReturnValue({
        version: '1.0',
        blocks: [
          {
            id: 'starter-id',
            metadata: { id: 'starter', name: 'Start' },
            config: {},
            inputs: {},
            outputs: {},
            position: { x: 100, y: 100 },
            enabled: true,
          },
          {
            id: 'agent-id',
            metadata: { id: 'agent', name: 'Agent 1' },
            config: {},
            inputs: {},
            outputs: {},
            position: { x: 634, y: -167 },
            enabled: true,
          },
        ],
        connections: [
          {
            source: 'starter-id',
            target: 'agent-id',
          },
        ],
        loops: {},
      }),
    })),
  }))

  vi.mock('@/executor', () => ({
    Executor: vi.fn().mockImplementation(() => ({
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: {
          response: {
            content: 'This is a test response',
            model: 'gpt-4o',
          },
        },
        logs: [],
        metadata: {
          duration: 1000,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
        },
      }),
    })),
  }))

  vi.mock('@/db', () => ({
    db: mockDb,
  }))
}

export function mockWorkflowAccessValidation(shouldSucceed = true) {
  if (shouldSucceed) {
    vi.mock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
          state: sampleWorkflowState,
        },
      }),
    }))
  } else {
    vi.mock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        error: {
          message: 'Access denied',
          status: 403,
        },
      }),
    }))
  }
}

export async function getMockedDependencies() {
  const utilsModule = await import('@/lib/utils')
  const logsModule = await import('@/lib/logs/execution-logger')
  const traceSpansModule = await import('@/lib/logs/trace-spans')
  const workflowUtilsModule = await import('@/lib/workflows/utils')
  const executorModule = await import('@/executor')
  const serializerModule = await import('@/serializer')
  const dbModule = await import('@/db')

  return {
    decryptSecret: utilsModule.decryptSecret,
    persistExecutionLogs: logsModule.persistExecutionLogs,
    persistExecutionError: logsModule.persistExecutionError,
    buildTraceSpans: traceSpansModule.buildTraceSpans,
    updateWorkflowRunCounts: workflowUtilsModule.updateWorkflowRunCounts,
    Executor: executorModule.Executor,
    Serializer: serializerModule.Serializer,
    db: dbModule.db,
  }
}

export function mockScheduleStatusDb({
  schedule = [
    {
      id: 'schedule-id',
      workflowId: 'workflow-id',
      status: 'active',
      failedCount: 0,
      lastRanAt: new Date('2024-01-01T00:00:00.000Z'),
      lastFailedAt: null,
      nextRunAt: new Date('2024-01-02T00:00:00.000Z'),
    },
  ],
  workflow = [
    {
      userId: 'user-id',
    },
  ],
}: {
  schedule?: any[]
  workflow?: any[]
} = {}) {
  vi.doMock('@/db', () => {
    let callCount = 0

    const select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            callCount += 1
            if (callCount === 1) return schedule
            if (callCount === 2) return workflow
            return []
          }),
        })),
      })),
    }))

    return {
      db: { select },
    }
  })
}

export function mockScheduleExecuteDb({
  schedules = [] as any[],
  workflowRecord = {
    id: 'workflow-id',
    userId: 'user-id',
    state: sampleWorkflowState,
  },
  envRecord = {
    userId: 'user-id',
    variables: {
      OPENAI_API_KEY: 'encrypted:openai-api-key',
      SERPER_API_KEY: 'encrypted:serper-api-key',
    },
  },
}: {
  schedules?: any[]
  workflowRecord?: any
  envRecord?: any
}): void {
  vi.doMock('@/db', () => {
    const select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: any) => {
        const tbl = String(table)
        if (tbl === 'workflow_schedule' || tbl === 'schedule') {
          return {
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => schedules),
            })),
          }
        }

        if (tbl === 'workflow') {
          return {
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => [workflowRecord]),
            })),
          }
        }

        if (tbl === 'environment') {
          return {
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => [envRecord]),
            })),
          }
        }

        return {
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => []),
          })),
        }
      }),
    }))

    const update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    }))

    return { db: { select, update } }
  })
}

/**
 * Mock authentication for API tests
 * @param user - Optional user object to use for authenticated requests
 * @returns Object with authentication helper functions
 */
export function mockAuth(user: MockUser = mockUser): MockAuthResult {
  const mockGetSession = vi.fn()

  vi.doMock('@/lib/auth', () => ({
    getSession: mockGetSession,
  }))

  const setAuthenticated = (customUser?: MockUser) =>
    mockGetSession.mockResolvedValue({ user: customUser || user })
  const setUnauthenticated = () => mockGetSession.mockResolvedValue(null)

  return {
    mockGetSession,
    mockAuthenticatedUser: setAuthenticated,
    mockUnauthenticated: setUnauthenticated,
    setAuthenticated,
    setUnauthenticated,
  }
}

/**
 * Mock common schema patterns
 */
export function mockCommonSchemas() {
  vi.doMock('@/db/schema', () => ({
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
 * Mock drizzle-orm operators
 */
export function mockDrizzleOrm() {
  vi.doMock('drizzle-orm', () => ({
    and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
    eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    or: vi.fn((...conditions) => ({ type: 'or', conditions })),
    gte: vi.fn((field, value) => ({ type: 'gte', field, value })),
    lte: vi.fn((field, value) => ({ type: 'lte', field, value })),
    asc: vi.fn((field) => ({ field, type: 'asc' })),
    desc: vi.fn((field) => ({ field, type: 'desc' })),
    isNull: vi.fn((field) => ({ field, type: 'isNull' })),
    count: vi.fn((field) => ({ field, type: 'count' })),
    sql: vi.fn((strings, ...values) => ({
      type: 'sql',
      sql: strings,
      values,
    })),
  }))
}

/**
 * Mock knowledge-related database schemas
 */
export function mockKnowledgeSchemas() {
  vi.doMock('@/db/schema', () => ({
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
      createdAt: 'created_at',
    },
  }))
}

/**
 * Mock console logger
 */
export function mockConsoleLogger() {
  vi.doMock('@/lib/logs/console-logger', () => ({
    createLogger: vi.fn().mockReturnValue(mockLogger),
  }))
}

/**
 * Setup common API test mocks (auth, logger, schema, drizzle)
 */
export function setupCommonApiMocks() {
  mockCommonSchemas()
  mockDrizzleOrm()
  mockConsoleLogger()
}

/**
 * Mock UUID generation for consistent test results
 */
export function mockUuid(mockValue = 'test-uuid') {
  vi.doMock('uuid', () => ({
    v4: vi.fn().mockReturnValue(mockValue),
  }))
}

/**
 * Mock crypto.randomUUID for tests
 */
export function mockCryptoUuid(mockValue = 'mock-uuid-1234-5678') {
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn().mockReturnValue(mockValue),
  })
}

/**
 * Mock file system operations
 */
export function mockFileSystem(
  options: { writeFileSuccess?: boolean; readFileContent?: string; existsResult?: boolean } = {}
) {
  const { writeFileSuccess = true, readFileContent = 'test content', existsResult = true } = options

  vi.doMock('fs/promises', () => ({
    writeFile: vi.fn().mockImplementation(() => {
      if (writeFileSuccess) {
        return Promise.resolve()
      }
      return Promise.reject(new Error('Write failed'))
    }),
    readFile: vi.fn().mockResolvedValue(readFileContent),
    stat: vi.fn().mockResolvedValue({ size: 100, isFile: () => true }),
    access: vi.fn().mockImplementation(() => {
      if (existsResult) {
        return Promise.resolve()
      }
      return Promise.reject(new Error('File not found'))
    }),
  }))
}

/**
 * Mock encryption utilities
 */
export function mockEncryption(options: { encryptedValue?: string; decryptedValue?: string } = {}) {
  const { encryptedValue = 'encrypted-value', decryptedValue = 'decrypted-value' } = options

  vi.doMock('@/lib/utils', () => ({
    encryptSecret: vi.fn().mockResolvedValue({ encrypted: encryptedValue }),
    decryptSecret: vi.fn().mockResolvedValue({ decrypted: decryptedValue }),
  }))
}

/**
 * Interface for storage provider mock configuration
 */
export interface StorageProviderMockOptions {
  provider?: 's3' | 'blob' | 'local'
  isCloudEnabled?: boolean
  throwError?: boolean
  errorMessage?: string
  presignedUrl?: string
  uploadHeaders?: Record<string, string>
}

/**
 * Create storage provider mocks (S3, Blob, Local)
 */
export function createStorageProviderMocks(options: StorageProviderMockOptions = {}) {
  const {
    provider = 's3',
    isCloudEnabled = true,
    throwError = false,
    errorMessage = 'Storage error',
    presignedUrl = 'https://example.com/presigned-url',
    uploadHeaders = {},
  } = options

  // Ensure UUID is mocked
  mockUuid('mock-uuid-1234')
  mockCryptoUuid('mock-uuid-1234-5678')

  // Base upload utilities
  vi.doMock('@/lib/uploads', () => ({
    getStorageProvider: vi.fn().mockReturnValue(provider),
    isUsingCloudStorage: vi.fn().mockReturnValue(isCloudEnabled),
    uploadFile: vi.fn().mockResolvedValue({
      path: '/api/files/serve/test-key',
      key: 'test-key',
      name: 'test.txt',
      size: 100,
      type: 'text/plain',
    }),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  }))

  if (provider === 's3') {
    vi.doMock('@/lib/uploads/s3/s3-client', () => ({
      getS3Client: vi.fn().mockReturnValue({}),
      sanitizeFilenameForMetadata: vi.fn((filename) => filename),
    }))

    vi.doMock('@/lib/uploads/setup', () => ({
      S3_CONFIG: {
        bucket: 'test-s3-bucket',
        region: 'us-east-1',
      },
    }))

    vi.doMock('@aws-sdk/client-s3', () => ({
      PutObjectCommand: vi.fn(),
    }))

    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn().mockImplementation(() => {
        if (throwError) {
          return Promise.reject(new Error(errorMessage))
        }
        return Promise.resolve(presignedUrl)
      }),
    }))
  } else if (provider === 'blob') {
    const baseUrl = presignedUrl.replace('?sas-token-string', '')
    const mockBlockBlobClient = {
      url: baseUrl,
    }
    const mockContainerClient = {
      getBlockBlobClient: vi.fn(() => mockBlockBlobClient),
    }
    const mockBlobServiceClient = {
      getContainerClient: vi.fn(() => {
        if (throwError) {
          throw new Error(errorMessage)
        }
        return mockContainerClient
      }),
    }

    vi.doMock('@/lib/uploads/blob/blob-client', () => ({
      getBlobServiceClient: vi.fn().mockReturnValue(mockBlobServiceClient),
      sanitizeFilenameForMetadata: vi.fn((filename) => filename),
    }))

    vi.doMock('@/lib/uploads/setup', () => ({
      BLOB_CONFIG: {
        accountName: 'testaccount',
        accountKey: 'testkey',
        containerName: 'test-container',
      },
    }))

    vi.doMock('@azure/storage-blob', () => ({
      BlobSASPermissions: {
        parse: vi.fn(() => 'w'),
      },
      generateBlobSASQueryParameters: vi.fn(() => ({
        toString: () => 'sas-token-string',
      })),
      StorageSharedKeyCredential: vi.fn(),
    }))
  }

  return {
    provider,
    isCloudEnabled,
    mockBlobClient: provider === 'blob' ? vi.fn() : undefined,
    mockS3Client: provider === 's3' ? vi.fn() : undefined,
  }
}

/**
 * Interface for auth API mock configuration with all auth operations
 */
export interface AuthApiMockOptions {
  operations?: {
    forgetPassword?: {
      success?: boolean
      error?: string
    }
    resetPassword?: {
      success?: boolean
      error?: string
    }
    signIn?: {
      success?: boolean
      error?: string
    }
    signUp?: {
      success?: boolean
      error?: string
    }
  }
}

/**
 * Interface for comprehensive test setup options
 */
export interface TestSetupOptions {
  auth?: {
    authenticated?: boolean
    user?: MockUser
  }
  database?: MockDatabaseOptions
  storage?: StorageProviderMockOptions
  authApi?: AuthApiMockOptions
  features?: {
    workflowUtils?: boolean
    fileSystem?: boolean
    uploadUtils?: boolean
    encryption?: boolean
  }
}

/**
 * Master setup function for comprehensive test mocking
 * This is the preferred setup function for new tests
 */
export function setupComprehensiveTestMocks(options: TestSetupOptions = {}) {
  const { auth = { authenticated: true }, database = {}, storage, authApi, features = {} } = options

  // Setup basic infrastructure mocks
  setupCommonApiMocks()
  mockUuid()
  mockCryptoUuid()

  // Setup authentication
  const authMocks = mockAuth(auth.user)
  if (auth.authenticated) {
    authMocks.setAuthenticated(auth.user)
  } else {
    authMocks.setUnauthenticated()
  }

  // Setup database
  const dbMocks = createMockDatabase(database)

  // Setup storage if needed
  let storageMocks
  if (storage) {
    storageMocks = createStorageProviderMocks(storage)
  }

  // Setup auth API if needed
  let authApiMocks
  if (authApi) {
    authApiMocks = createAuthApiMocks(authApi)
  }

  // Setup feature-specific mocks
  const featureMocks: any = {}
  if (features.workflowUtils) {
    featureMocks.workflowUtils = mockWorkflowUtils()
  }
  if (features.fileSystem) {
    featureMocks.fileSystem = mockFileSystem()
  }
  if (features.uploadUtils) {
    featureMocks.uploadUtils = mockUploadUtils()
  }
  if (features.encryption) {
    featureMocks.encryption = mockEncryption()
  }

  return {
    auth: authMocks,
    database: dbMocks,
    storage: storageMocks,
    authApi: authApiMocks,
    features: featureMocks,
  }
}

/**
 * Create a more focused and composable database mock
 */
export function createMockDatabase(options: MockDatabaseOptions = {}) {
  const selectOptions = options.select || { results: [[]], throwError: false }
  const insertOptions = options.insert || { results: [{ id: 'mock-id' }], throwError: false }
  const updateOptions = options.update || { results: [{ id: 'mock-id' }], throwError: false }
  const deleteOptions = options.delete || { results: [{ id: 'mock-id' }], throwError: false }
  const transactionOptions = options.transaction || { throwError: false }

  let selectCallCount = 0

  // Helper to create error
  const createDbError = (operation: string, message?: string) => {
    return new Error(message || `Database ${operation} error`)
  }

  // Create chainable select mock
  const createSelectChain = () => ({
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockImplementation(() => {
      if (selectOptions.throwError) {
        return Promise.reject(createDbError('select', selectOptions.errorMessage))
      }
      const result = selectOptions.results?.[selectCallCount] || selectOptions.results?.[0] || []
      selectCallCount++
      return Promise.resolve(result)
    }),
    limit: vi.fn().mockImplementation(() => {
      if (selectOptions.throwError) {
        return Promise.reject(createDbError('select', selectOptions.errorMessage))
      }
      const result = selectOptions.results?.[selectCallCount] || selectOptions.results?.[0] || []
      selectCallCount++
      return Promise.resolve(result)
    }),
  })

  // Create insert chain
  const createInsertChain = () => ({
    values: vi.fn().mockImplementation(() => ({
      returning: vi.fn().mockImplementation(() => {
        if (insertOptions.throwError) {
          return Promise.reject(createDbError('insert', insertOptions.errorMessage))
        }
        return Promise.resolve(insertOptions.results)
      }),
      onConflictDoUpdate: vi.fn().mockImplementation(() => {
        if (insertOptions.throwError) {
          return Promise.reject(createDbError('insert', insertOptions.errorMessage))
        }
        return Promise.resolve(insertOptions.results)
      }),
    })),
  })

  // Create update chain
  const createUpdateChain = () => ({
    set: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => {
        if (updateOptions.throwError) {
          return Promise.reject(createDbError('update', updateOptions.errorMessage))
        }
        return Promise.resolve(updateOptions.results)
      }),
    })),
  })

  // Create delete chain
  const createDeleteChain = () => ({
    where: vi.fn().mockImplementation(() => {
      if (deleteOptions.throwError) {
        return Promise.reject(createDbError('delete', deleteOptions.errorMessage))
      }
      return Promise.resolve(deleteOptions.results)
    }),
  })

  // Create transaction mock
  const createTransactionMock = () => {
    return vi.fn().mockImplementation(async (callback: any) => {
      if (transactionOptions.throwError) {
        throw createDbError('transaction', transactionOptions.errorMessage)
      }

      const tx = {
        select: vi.fn().mockImplementation(() => createSelectChain()),
        insert: vi.fn().mockImplementation(() => createInsertChain()),
        update: vi.fn().mockImplementation(() => createUpdateChain()),
        delete: vi.fn().mockImplementation(() => createDeleteChain()),
      }
      return await callback(tx)
    })
  }

  const mockDb = {
    select: vi.fn().mockImplementation(() => createSelectChain()),
    insert: vi.fn().mockImplementation(() => createInsertChain()),
    update: vi.fn().mockImplementation(() => createUpdateChain()),
    delete: vi.fn().mockImplementation(() => createDeleteChain()),
    transaction: createTransactionMock(),
  }

  vi.doMock('@/db', () => ({ db: mockDb }))

  return {
    mockDb,
    resetSelectCallCount: () => {
      selectCallCount = 0
    },
  }
}

/**
 * Create comprehensive auth API mocks
 */
export function createAuthApiMocks(options: AuthApiMockOptions = {}) {
  const { operations = {} } = options

  const defaultOperations = {
    forgetPassword: { success: true, error: 'Forget password error' },
    resetPassword: { success: true, error: 'Reset password error' },
    signIn: { success: true, error: 'Sign in error' },
    signUp: { success: true, error: 'Sign up error' },
    ...operations,
  }

  const createAuthMethod = (operation: string, config: { success?: boolean; error?: string }) => {
    return vi.fn().mockImplementation(() => {
      if (config.success) {
        return Promise.resolve()
      }
      return Promise.reject(new Error(config.error))
    })
  }

  vi.doMock('@/lib/auth', () => ({
    auth: {
      api: {
        forgetPassword: createAuthMethod('forgetPassword', defaultOperations.forgetPassword),
        resetPassword: createAuthMethod('resetPassword', defaultOperations.resetPassword),
        signIn: createAuthMethod('signIn', defaultOperations.signIn),
        signUp: createAuthMethod('signUp', defaultOperations.signUp),
      },
    },
  }))

  return {
    operations: defaultOperations,
  }
}

/**
 * Mock workflow utilities and response helpers
 */
export function mockWorkflowUtils() {
  vi.doMock('@/app/api/workflows/utils', () => ({
    createSuccessResponse: vi.fn().mockImplementation((data) => {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
    createErrorResponse: vi.fn().mockImplementation((message, status = 500) => {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  }))
}

/**
 * Setup grouped mocks for knowledge base operations
 */
export function setupKnowledgeMocks(
  options: {
    withDocumentProcessing?: boolean
    withEmbedding?: boolean
    accessCheckResult?: boolean
  } = {}
) {
  const {
    withDocumentProcessing = false,
    withEmbedding = false,
    accessCheckResult = true,
  } = options

  const mocks: any = {
    checkKnowledgeBaseAccess: vi.fn().mockResolvedValue(accessCheckResult),
  }

  if (withDocumentProcessing) {
    mocks.processDocumentAsync = vi.fn().mockResolvedValue(undefined)
  }

  if (withEmbedding) {
    mocks.generateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
  }

  // Mock the knowledge utilities
  vi.doMock('@/app/api/knowledge/utils', () => mocks)

  return mocks
}

/**
 * Setup for file-related API routes
 */
export function setupFileApiMocks(
  options: {
    authenticated?: boolean
    storageProvider?: 's3' | 'blob' | 'local'
    cloudEnabled?: boolean
  } = {}
) {
  const { authenticated = true, storageProvider = 's3', cloudEnabled = true } = options

  // Setup basic mocks
  setupCommonApiMocks()
  mockUuid()
  mockCryptoUuid()

  // Setup auth
  const authMocks = mockAuth()
  if (authenticated) {
    authMocks.setAuthenticated()
  } else {
    authMocks.setUnauthenticated()
  }

  // Setup file system mocks
  mockFileSystem({
    writeFileSuccess: true,
    readFileContent: 'test content',
    existsResult: true,
  })

  // Setup storage provider mocks (this will mock @/lib/uploads)
  let storageMocks
  if (storageProvider) {
    storageMocks = createStorageProviderMocks({
      provider: storageProvider,
      isCloudEnabled: cloudEnabled,
    })
  } else {
    // If no storage provider specified, just mock the base functions
    vi.doMock('@/lib/uploads', () => ({
      getStorageProvider: vi.fn().mockReturnValue('local'),
      isUsingCloudStorage: vi.fn().mockReturnValue(cloudEnabled),
      uploadFile: vi.fn().mockResolvedValue({
        path: '/api/files/serve/test-key',
        key: 'test-key',
        name: 'test.txt',
        size: 100,
        type: 'text/plain',
      }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }))
  }

  return {
    auth: authMocks,
    storage: storageMocks,
  }
}

/**
 * Setup for auth-related API routes
 */
export function setupAuthApiMocks(options: { operations?: AuthApiMockOptions['operations'] } = {}) {
  return setupComprehensiveTestMocks({
    auth: { authenticated: false }, // Auth routes typically don't require authentication
    authApi: { operations: options.operations },
  })
}

/**
 * Setup for knowledge base API routes
 */
export function setupKnowledgeApiMocks(
  options: {
    authenticated?: boolean
    withDocumentProcessing?: boolean
    withEmbedding?: boolean
  } = {}
) {
  const mocks = setupComprehensiveTestMocks({
    auth: { authenticated: options.authenticated ?? true },
    database: {
      select: { results: [[]] },
    },
  })

  const knowledgeMocks = setupKnowledgeMocks({
    withDocumentProcessing: options.withDocumentProcessing,
    withEmbedding: options.withEmbedding,
  })

  return {
    ...mocks,
    knowledge: knowledgeMocks,
  }
}

// Legacy functions for backward compatibility (DO NOT REMOVE - still used in tests)

/**
 * @deprecated Use mockAuth instead - provides same functionality with improved interface
 */
export function mockAuthSession(isAuthenticated = true, user: MockUser = mockUser) {
  const authMocks = mockAuth(user)
  if (isAuthenticated) {
    authMocks.setAuthenticated(user)
  } else {
    authMocks.setUnauthenticated()
  }
  return authMocks
}

/**
 * @deprecated Use setupComprehensiveTestMocks instead - provides better organization and features
 */
export function setupApiTestMocks(
  options: {
    authenticated?: boolean
    user?: MockUser
    dbResults?: any[][]
    withWorkflowUtils?: boolean
    withFileSystem?: boolean
    withUploadUtils?: boolean
  } = {}
) {
  const {
    authenticated = true,
    user = mockUser,
    dbResults = [[]],
    withWorkflowUtils = false,
    withFileSystem = false,
    withUploadUtils = false,
  } = options

  return setupComprehensiveTestMocks({
    auth: { authenticated, user },
    database: { select: { results: dbResults } },
    features: {
      workflowUtils: withWorkflowUtils,
      fileSystem: withFileSystem,
      uploadUtils: withUploadUtils,
    },
  })
}

/**
 * @deprecated Use createStorageProviderMocks instead
 */
export function mockUploadUtils(
  options: { isCloudStorage?: boolean; uploadResult?: any; uploadError?: boolean } = {}
) {
  const {
    isCloudStorage = false,
    uploadResult = {
      path: '/api/files/serve/test-key',
      key: 'test-key',
      name: 'test.txt',
      size: 100,
      type: 'text/plain',
    },
    uploadError = false,
  } = options

  vi.doMock('@/lib/uploads', () => ({
    uploadFile: vi.fn().mockImplementation(() => {
      if (uploadError) {
        return Promise.reject(new Error('Upload failed'))
      }
      return Promise.resolve(uploadResult)
    }),
    isUsingCloudStorage: vi.fn().mockReturnValue(isCloudStorage),
  }))

  vi.doMock('@/lib/uploads/setup', () => ({
    UPLOAD_DIR: '/test/uploads',
    USE_S3_STORAGE: isCloudStorage,
    USE_BLOB_STORAGE: false,
    ensureUploadsDirectory: vi.fn().mockResolvedValue(true),
    S3_CONFIG: {
      bucket: 'test-bucket',
      region: 'test-region',
    },
  }))
}

/**
 * Create a mock transaction function for database testing
 * @deprecated Use createMockDatabase instead
 */
export function createMockTransaction(
  mockData: {
    selectData?: DatabaseSelectResult[]
    insertResult?: DatabaseInsertResult[]
    updateResult?: DatabaseUpdateResult[]
    deleteResult?: DatabaseDeleteResult[]
  } = {}
) {
  const { selectData = [], insertResult = [], updateResult = [], deleteResult = [] } = mockData

  return vi.fn().mockImplementation(async (callback: any) => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue(selectData),
            }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue(insertResult),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(updateResult),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(deleteResult),
      }),
    }
    return await callback(tx)
  })
}
