/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { uploadsCopilotMock, uploadsCopilotMockFns } from '@sim/testing/mocks/uploads-copilot.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, UserFile } from '@/executor/types'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/credentials/oci-object-storage-service-account', () => ({
  getOciObjectStorageServiceAccountSecret: async () => ({
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    namespace: 'namespace1',
    region: 'us-ashburn-1',
  }),
}))
vi.mock('@/lib/internal/oci-object-storage/client', () => ({
  withOciObjectStorageClient: async (
    _secret: unknown,
    _attempts: number,
    execute: (client: { send: typeof mocks.send }) => Promise<unknown>
  ) => execute({ send: mocks.send }),
}))
vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)
vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)

import { readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { executeOciObjectStorageTool } from '@/lib/internal/oci-object-storage/execute-tool'
import { presentInternalToolOperationResult } from '@/lib/internal/tool-operations/file-result.server'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { FileToolProcessor } from '@/executor/utils/file-tool-processor'
import { ociObjectStorageDownloadObjectTool } from '@/tools/oci_object_storage/download_object'
import { createOciObjectStorageOperationInput } from '@/tools/oci_object_storage/shared'

const { mockUploadExecutionFile } = uploadsExecutionMockFns
const { mockUploadCopilotFile } = uploadsCopilotMockFns
const bytes = Buffer.alloc(12 * 1024 * 1024, 65)
const runContext: InternalToolOperationContext = {
  executionId: 'execution-1',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
}

// The provider boundary must store large files before JSON admission in either execution surface.
describe('OCI Object Storage download file output', () => {
  beforeEach(() => {
    mockUploadExecutionFile.mockReset()
    mockUploadCopilotFile.mockReset()
    mocks.send.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand)
        return { ContentLength: bytes.length, ContentType: 'text/plain', $metadata: {} }
      if (command instanceof GetObjectCommand)
        return {
          Body: Readable.from([bytes]),
          ContentType: 'text/plain',
          ETag: 'etag-1',
          $metadata: {},
        }
      throw new Error('Unexpected provider request')
    })
  })

  it.each(['workflow', 'copilot'] as const)(
    'admits a 12 MiB %s download as one stored file without inline aliases',
    async (surface) => {
      const context =
        surface === 'workflow'
          ? runContext
          : { ...runContext, workflowId: '', copilotToolExecution: true }
      const stored: UserFile = {
        id: 'file-1',
        key: `${surface === 'workflow' ? 'execution' : 'copilot'}/file-1/report.txt`,
        name: 'report.txt',
        size: bytes.length,
        type: 'text/plain',
        url: '/api/files/serve?key=file-1',
        context: surface === 'workflow' ? 'execution' : 'copilot',
      }
      mockUploadExecutionFile.mockResolvedValue(stored)
      mockUploadCopilotFile.mockResolvedValue(stored)
      const result = await executeOciObjectStorageTool({
        toolId: 'oci_object_storage_download_object',
        input: {
          credentialId: 'credential-1',
          bucketName: 'documents',
          objectKey: 'reports/report.txt',
        },
        context,
        requestId: 'request-1',
        headers: new Headers(),
      })
      const response = await presentInternalToolOperationResult(result, context)
      const body = await readResponseToBufferWithLimit(response, {
        maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
        label: 'Tool response body',
      })
      expect(body.length).toBeLessThan(1024)
      const payload = JSON.parse(body.toString('utf8'))
      expect(payload).toEqual({
        success: true,
        output: {
          file: stored,
          bucket: 'documents',
          key: 'reports/report.txt',
          etag: 'etag-1',
          lastModified: null,
          metadata: {},
          requestId: null,
        },
      })
      const processed = await FileToolProcessor.processToolOutputs(
        payload.output,
        ociObjectStorageDownloadObjectTool,
        context as ExecutionContext
      )
      expect(processed.file).toEqual(stored)
      const uploads = [...mockUploadExecutionFile.mock.calls, ...mockUploadCopilotFile.mock.calls]
      expect(uploads).toHaveLength(1)
      const uploaded = surface === 'workflow' ? uploads[0]?.[1] : uploads[0]?.[0].buffer
      expect(Buffer.isBuffer(uploaded) && uploaded.equals(bytes)).toBe(true)
    }
  )

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
