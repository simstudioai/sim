import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  query: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/internal/vanta/operations', () => ({
  executeVantaDownloadDocumentFile: mocks.download,
  executeVantaQuery: mocks.query,
  executeVantaUploadDocumentFile: mocks.upload,
}))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { executeVantaTool } from '@/lib/internal/vanta/execute-tool'

const INPUTS = {
  vanta_download_document_file: {
    clientId: 'client',
    clientSecret: 'secret',
    documentId: 'document-1',
    uploadedFileId: 'upload-1',
  },
  vanta_upload_document_file: {
    clientId: 'client',
    clientSecret: 'secret',
    documentId: 'document-1',
    fileContent: Buffer.from('hello').toString('base64'),
  },
  vanta_list_frameworks: {
    operation: 'vanta_list_frameworks',
    clientId: 'client',
    clientSecret: 'secret',
    pageSize: 25,
  },
} as const

function request(
  toolId: keyof typeof INPUTS,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId,
    input: INPUTS[toolId],
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      executionId: 'execution-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeVantaTool', () => {
  beforeEach(() => {
    mocks.download.mockResolvedValue({ success: true, output: { file: {} } })
    mocks.query.mockResolvedValue({ success: true, output: { frameworks: [] } })
    mocks.upload.mockResolvedValue({ success: true, output: { upload: {} } })
  })

  it('rejects a query operation that does not match the registered tool ID', async () => {
    const response = await executeVantaTool(
      request('vanta_list_frameworks', {
        input: {
          operation: 'vanta_get_framework',
          clientId: 'client',
          clientSecret: 'secret',
          frameworkId: 'framework-1',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
