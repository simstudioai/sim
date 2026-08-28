/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  uploadExecutionFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: { uploadFile: vi.fn() },
}))

import { compileLatexDocument } from '@/lib/internal/latex/operations'

describe('compileLatexDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'application/pdf' },
      })
    )
    mocks.uploadExecutionFile.mockResolvedValue({ id: 'file-1', url: '/file-1' })
  })

  it('submits once and stores the bounded PDF in execution scope', async () => {
    const controller = new AbortController()
    const result = await compileLatexDocument(
      {
        content: '\\documentclass{article}\\begin{document}x\\end{document}',
        compiler: 'xelatex',
        fileName: '../report.pdf',
      },
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        signal: controller.signal,
      }
    )

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      expect.any(Buffer),
      'report.pdf',
      'application/pdf',
      'user-1'
    )
    expect(result).toEqual(
      expect.objectContaining({ pdfUrl: '/file-1', fileName: 'report.pdf', compiler: 'xelatex' })
    )
  })
})
