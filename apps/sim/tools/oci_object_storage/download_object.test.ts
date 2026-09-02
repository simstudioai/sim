/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, UserFile } from '@/executor/types'

const { mockDownloadFileFromUrl, mockUploadExecutionFile } = vi.hoisted(() => ({
  mockDownloadFileFromUrl: vi.fn(),
  mockUploadExecutionFile: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromUrl: mockDownloadFileFromUrl,
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mockUploadExecutionFile,
  uploadFileFromRawData: vi.fn(),
}))

import { FileToolProcessor } from '@/executor/utils/file-tool-processor'
import { ociObjectStorageDownloadObjectTool } from '@/tools/oci_object_storage/download_object'
import { createOciObjectStorageOperationInput } from '@/tools/oci_object_storage/shared'

const executionContext = {
  executionId: 'execution-1',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
} as ExecutionContext

describe('OCI Object Storage download file output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      key: 'workspace/workspace-1/file-1',
      name: 'report.txt',
      size: 5,
      type: 'text/plain',
      url: '/api/files/serve?key=workspace%2Fworkspace-1%2Ffile-1',
    } satisfies UserFile)
  })

  it('persists the canonical inline file through FileToolProcessor', async () => {
    const result = await FileToolProcessor.processToolOutputs(
      {
        file: {
          name: 'report.txt',
          mimeType: 'text/plain',
          data: Buffer.from('hello').toString('base64'),
          size: 5,
        },
        bucket: 'documents',
        key: 'reports/report.txt',
      },
      ociObjectStorageDownloadObjectTool,
      executionContext
    )

    expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      Buffer.from('hello'),
      'report.txt',
      'text/plain',
      'user-1'
    )
    expect(result.file).toEqual(expect.objectContaining({ id: 'file-1', name: 'report.txt' }))
    expect(result).toEqual(
      expect.objectContaining({ bucket: 'documents', key: 'reports/report.txt' })
    )
  })

  it('passes only the executor-authorized credential reference to provider code', () => {
    expect(
      createOciObjectStorageOperationInput({
        oauthCredential: 'caller-visible-reference',
        accessToken: 'authorized-credential-reference',
        bucketName: 'documents',
      })
    ).toEqual({
      credentialId: 'authorized-credential-reference',
      bucketName: 'documents',
    })
    expect(
      createOciObjectStorageOperationInput({
        oauthCredential: 'caller-visible-reference',
        bucketName: 'documents',
      })
    ).toEqual({ credentialId: '', bucketName: 'documents' })
  })
})
