import { databaseMock, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ExecutionLogger } from '@/lib/logs/execution/logger'

vi.mock('@sim/db', () => databaseMock)

// Mock database schema
vi.mock('@sim/db/schema', () => ({
  member: {},
  userStats: {},
  user: {},
  workflow: {},
  workflowExecutionLogs: {},
}))

// Mock billing modules
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  checkUsageStatus: vi.fn(() =>
    Promise.resolve({
      usageData: { limit: 100, percentUsed: 50, currentUsage: 50 },
    })
  ),
  getOrgUsageLimit: vi.fn(() => Promise.resolve({ limit: 1000 })),
  maybeSendUsageThresholdEmail: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  logWorkflowUsageBatch: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isBillingEnabled: false,
}))

// Mock security module
vi.mock('@/lib/core/security/redaction', () => ({
  redactApiKeys: vi.fn((data) => data),
}))

// Mock display filters
vi.mock('@/lib/core/utils/display-filters', () => ({
  filterForDisplay: vi.fn((data) => data),
}))

vi.mock('@sim/logger', () => loggerMock)

// Mock events
vi.mock('@/lib/logs/events', () => ({
  emitWorkflowExecutionCompleted: vi.fn(() => Promise.resolve()),
}))

// Mock snapshot service
vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: {
    createSnapshotWithDeduplication: vi.fn(() =>
      Promise.resolve({
        snapshot: {
          id: 'snapshot-123',
          workflowId: 'workflow-123',
          stateHash: 'hash-123',
          stateData: { blocks: {}, edges: [], loops: {}, parallels: {} },
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        isNew: true,
      })
    ),
    getSnapshot: vi.fn(() =>
      Promise.resolve({
        id: 'snapshot-123',
        workflowId: 'workflow-123',
        stateHash: 'hash-123',
        stateData: { blocks: {}, edges: [], loops: {}, parallels: {} },
        createdAt: '2024-01-01T00:00:00.000Z',
      })
    ),
  },
}))

describe('ExecutionLogger', () => {
  let logger: ExecutionLogger

  beforeEach(() => {
    logger = new ExecutionLogger()
    vi.clearAllMocks()
  })

  describe('class instantiation', () => {
    test('should create logger instance', () => {
      expect(logger).toBeDefined()
      expect(logger).toBeInstanceOf(ExecutionLogger)
    })
  })

  describe('interface implementation', () => {
    test('should have startWorkflowExecution method', () => {
      expect(typeof logger.startWorkflowExecution).toBe('function')
    })

    test('should have completeWorkflowExecution method', () => {
      expect(typeof logger.completeWorkflowExecution).toBe('function')
    })

    test('should have getWorkflowExecution method', () => {
      expect(typeof logger.getWorkflowExecution).toBe('function')
    })
  })

  describe('file extraction', () => {
    test('should extract files from trace spans with files property', () => {
      const loggerInstance = new ExecutionLogger()

      // Access the private method through the class prototype
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const traceSpans = [
        {
          id: 'span-1',
          output: {
            files: [
              {
                id: 'file-1',
                name: 'test.pdf',
                size: 1024,
                type: 'application/pdf',
                url: 'https://example.com/file.pdf',
                key: 'uploads/file.pdf',
              },
            ],
          },
        },
      ]

      const files = extractFilesMethod(traceSpans, null, null)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('test.pdf')
      expect(files[0].id).toBe('file-1')
    })

    test('should extract files from attachments property', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const traceSpans = [
        {
          id: 'span-1',
          output: {
            attachments: [
              {
                id: 'attach-1',
                name: 'attachment.docx',
                size: 2048,
                type: 'application/docx',
                url: 'https://example.com/attach.docx',
                key: 'attachments/attach.docx',
              },
            ],
          },
        },
      ]

      const files = extractFilesMethod(traceSpans, null, null)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('attachment.docx')
    })

    test('should deduplicate files with same ID', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const duplicateFile = {
        id: 'file-1',
        name: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        url: 'https://example.com/file.pdf',
        key: 'uploads/file.pdf',
      }

      const traceSpans = [
        { id: 'span-1', output: { files: [duplicateFile] } },
        { id: 'span-2', output: { files: [duplicateFile] } },
      ]

      const files = extractFilesMethod(traceSpans, null, null)
      expect(files).toHaveLength(1)
    })

    test('should extract files from final output', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const finalOutput = {
        files: [
          {
            id: 'output-file-1',
            name: 'output.txt',
            size: 512,
            type: 'text/plain',
            url: 'https://example.com/output.txt',
            key: 'outputs/output.txt',
          },
        ],
      }

      const files = extractFilesMethod([], finalOutput, null)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('output.txt')
    })

    test('should extract files from workflow input', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const workflowInput = {
        files: [
          {
            id: 'input-file-1',
            name: 'input.csv',
            size: 256,
            type: 'text/csv',
            url: 'https://example.com/input.csv',
            key: 'inputs/input.csv',
          },
        ],
      }

      const files = extractFilesMethod([], null, workflowInput)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('input.csv')
    })

    test('should handle empty inputs', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const files = extractFilesMethod(undefined, undefined, undefined)
      expect(files).toHaveLength(0)
    })

    test('should handle deeply nested file objects', () => {
      const loggerInstance = new ExecutionLogger()
      const extractFilesMethod = (loggerInstance as any).extractFilesFromExecution.bind(
        loggerInstance
      )

      const traceSpans = [
        {
          id: 'span-1',
          output: {
            nested: {
              deeply: {
                files: [
                  {
                    id: 'nested-file-1',
                    name: 'nested.json',
                    size: 128,
                    type: 'application/json',
                    url: 'https://example.com/nested.json',
                    key: 'nested/file.json',
                  },
                ],
              },
            },
          },
        },
      ]

      const files = extractFilesMethod(traceSpans, null, null)
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('nested.json')
    })
  })
})
