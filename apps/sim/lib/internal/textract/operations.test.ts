import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend, mockDestroy, mockResolveDocumentInput, mockDetectDocumentTextCommand } =
  vi.hoisted(() => ({
    mockSend: vi.fn(),
    mockDestroy: vi.fn(),
    mockResolveDocumentInput: vi.fn(),
    mockDetectDocumentTextCommand: vi.fn(),
  }))

vi.mock('@aws-sdk/client-textract', () => ({
  AnalyzeDocumentCommand: vi.fn(),
  AnalyzeExpenseCommand: vi.fn(),
  AnalyzeIDCommand: vi.fn(),
  DetectDocumentTextCommand: mockDetectDocumentTextCommand,
  GetDocumentAnalysisCommand: vi.fn(),
  GetDocumentTextDetectionCommand: vi.fn(),
  GetExpenseAnalysisCommand: vi.fn(),
  StartDocumentAnalysisCommand: vi.fn(),
  StartDocumentTextDetectionCommand: vi.fn(),
  StartExpenseAnalysisCommand: vi.fn(),
  TextractClient: class {
    send = mockSend
    destroy = mockDestroy
  },
}))

vi.mock('@/lib/internal/textract/document-input', () => ({
  parseS3Uri: vi.fn(),
  resolveDocumentInput: mockResolveDocumentInput,
}))

import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import { executeTextractParse } from '@/lib/internal/textract/operations'

const INPUT = {
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  region: 'us-east-1',
  processingMode: 'sync' as const,
  filePath: 'https://example.com/document.png',
}

function createContext(headers = new Headers(), signal?: AbortSignal) {
  return {
    headers,
    userId: 'user-1',
    requestId: 'request-1',
    signal,
  }
}

describe('Textract operations', () => {
  beforeEach(() => {
    mockResolveDocumentInput.mockResolvedValue({
      ok: true,
      document: {
        bytes: Buffer.from('document'),
        contentType: 'image/png',
        isPdf: false,
      },
    })
    mockSend.mockResolvedValue({
      Blocks: [],
      DocumentMetadata: { Pages: 1 },
      DetectDocumentTextModelVersion: '1.0',
    })
  })

  it('rejects malformed private provenance before file or AWS work', async () => {
    const headers = new Headers({ [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: 'forged-protocol' })

    const response = await executeTextractParse(INPUT, createContext(headers))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Invalid model input provenance',
    })
    expect(mockResolveDocumentInput).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })
})
