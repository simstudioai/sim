/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadServableFileFromStorage, mockResolveWorkspaceFile, mockVerifyFileAccess } =
  vi.hoisted(() => ({
    mockDownloadServableFileFromStorage: vi.fn(),
    mockResolveWorkspaceFile: vi.fn(),
    mockVerifyFileAccess: vi.fn(),
  }))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFileFromStorage,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFile,
}))

import { readUserFileContent } from '@/lib/execution/payloads/materialization.server'
import type { UserFile } from '@/executor/types'

const PDF_SOURCE = Buffer.from('from reportlab.pdfgen import canvas')
const PDF_BYTES = Buffer.from('%PDF-1.4 rendered bytes')

const generatedPdf: UserFile = {
  id: 'file-1',
  name: 'report.pdf',
  url: '',
  size: PDF_SOURCE.length,
  type: 'text/x-python-pdf',
  key: 'workspace/2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f/1700000000000-abc1234-report.pdf',
}

describe('readUserFileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generatedPdf.size = PDF_SOURCE.length
    mockVerifyFileAccess.mockResolvedValue(true)
    mockResolveWorkspaceFile.mockResolvedValue({ id: 'file-1' })
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: PDF_BYTES,
      contentType: 'application/pdf',
    })
  })

  it('returns the compiled artifact instead of the stored generation source', async () => {
    const content = await readUserFileContent(generatedPdf, {
      userId: 'user-1',
      encoding: 'base64',
    })

    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledOnce()
    expect(content).toBe(PDF_BYTES.toString('base64'))
    expect(content).not.toBe(PDF_SOURCE.toString('base64'))
    expect(generatedPdf.size).toBe(PDF_BYTES.length)
  })

  it('authorizes execution-scoped files without inventing a human subject', async () => {
    const executionFile: UserFile = {
      id: 'file-2',
      name: 'result.txt',
      url: '',
      size: 6,
      type: 'text/plain',
      key: 'execution/workspace-1/workflow-1/execution-1/result.txt',
      context: 'execution',
    }
    mockDownloadServableFileFromStorage.mockResolvedValueOnce({ buffer: Buffer.from('result') })

    await expect(
      readUserFileContent(executionFile, {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        encoding: 'text',
      })
    ).resolves.toBe('result')

    expect(mockVerifyFileAccess).not.toHaveBeenCalled()
  })

  it('authorizes workspace files with the preserved actorless deployment principal', async () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      workspaceId: 'workspace-1',
      delegationId: 'function-1',
      audience: 'sim:function-executions',
      issuedAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60_000),
      delegationContext: {
        kind: 'workflow_execution' as const,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        principal: {
          kind: 'system' as const,
          serviceId: 'schedule' as const,
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment' as const,
          deploymentVersionId: 'deployment-1',
        },
      },
    }

    await readUserFileContent(generatedPdf, {
      principal,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      requestId: 'request-1',
      encoding: 'base64',
    })

    expect(mockVerifyFileAccess).not.toHaveBeenCalled()
    expect(mockResolveWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        reference: generatedPdf.key,
        principal: expect.objectContaining({
          audience: 'sim:workspace-files',
          delegationContext: principal.delegationContext,
        }),
      })
    )
  })
})
