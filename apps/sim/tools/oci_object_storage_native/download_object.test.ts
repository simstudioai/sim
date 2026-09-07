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
import { ociObjectStorageNativeDownloadObjectTool } from '@/tools/oci_object_storage_native/download_object'
import { createOciNativeOperationInput } from '@/tools/oci_object_storage_native/shared'

const executionContext = {
  executionId: 'execution-1',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
} as ExecutionContext

describe('OCI Object Storage Native download file output', () => {
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

  it.each([0, 5, 100 * 1024 * 1024])(
    'preserves a persisted UserFile of %i bytes without fetching or re-uploading',
    async (size) => {
      const file = {
        id: 'file-1',
        key: 'workspace/workspace-1/file-1',
        name: 'report.txt',
        size,
        type: 'text/plain',
        url: '/api/files/serve?key=workspace%2Fworkspace-1%2Ffile-1',
      } satisfies UserFile
      const result = await FileToolProcessor.processToolOutputs(
        { file, bucketName: 'reports', objectName: 'report.txt' },
        ociObjectStorageNativeDownloadObjectTool,
        executionContext
      )
      expect(result.file).toEqual(file)
      expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
      expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    }
  )

  it('passes only the executor-authorized credential reference to provider code', () => {
    expect(
      createOciNativeOperationInput(
        {
          oauthCredential: 'caller-visible-reference',
          accessToken: 'authorized-credential-reference',
          bucketName: 'documents',
        },
        ['bucketName']
      )
    ).toEqual({
      credentialId: 'authorized-credential-reference',
      bucketName: 'documents',
    })
    expect(
      createOciNativeOperationInput(
        {
          oauthCredential: 'caller-visible-reference',
          bucketName: 'documents',
        },
        ['bucketName']
      )
    ).toEqual({ credentialId: '', bucketName: 'documents' })
  })
})
