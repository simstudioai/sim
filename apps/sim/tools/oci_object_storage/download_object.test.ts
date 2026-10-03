/**
 * @vitest-environment node
 */
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, UserFile } from '@/executor/types'

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)

import { FileToolProcessor } from '@/executor/utils/file-tool-processor'
import { ociObjectStorageDownloadObjectTool } from '@/tools/oci_object_storage/download_object'
import { createOciObjectStorageOperationInput } from '@/tools/oci_object_storage/shared'

const mockDownloadFileFromUrl = fileUtilsServerMockFns.mockDownloadFileFromUrl
const mockUploadExecutionFile = uploadsExecutionMockFns.mockUploadExecutionFile

const executionContext = {
  executionId: 'execution-1',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
} as ExecutionContext

describe('OCI Object Storage download file output', () => {
  beforeEach(() => {
    mockDownloadFileFromUrl.mockReset()
    mockUploadExecutionFile.mockReset()
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
      createOciObjectStorageOperationInput(
        {
          oauthCredential: 'caller-visible-reference',
          accessToken: 'authorized-credential-reference',
          credentialId: 'forged-reference',
          workspaceId: 'untrusted',
          operation: 'oci_object_storage_list_buckets',
          bucketName: 'documents',
        },
        ['bucketName']
      )
    ).toEqual({
      credentialId: 'authorized-credential-reference',
      bucketName: 'documents',
    })
    expect(
      createOciObjectStorageOperationInput(
        {
          oauthCredential: 'caller-visible-reference',
          bucketName: 'documents',
        },
        ['bucketName']
      )
    ).toEqual({ credentialId: '', bucketName: 'documents' })
  })
})
