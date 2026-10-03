/**
 * @vitest-environment node
 */
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { storageServiceMock } from '@sim/testing/mocks/storage-service.mock'
import { uploadsCopilotMock, uploadsCopilotMockFns } from '@sim/testing/mocks/uploads-copilot.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { uploadsMetadataMock } from '@sim/testing/mocks/uploads-metadata.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import type { UserFile } from '@/executor/types'

const fileInputMocks = vi.hoisted(() => ({ resolveAgiloftAttachmentFile: vi.fn() }))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/internal/agiloft/file-input', () => fileInputMocks)
vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)
vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns
const { mockUploadExecutionFile } = uploadsExecutionMockFns
const { mockUploadCopilotFile } = uploadsCopilotMockFns
const { mockDownloadFileFromUrl } = fileUtilsServerMockFns

import { agiloftRetrieveResponseSchema } from '@/lib/api/contracts/tools/agiloft'
import { readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { executeAgiloftTool } from '@/lib/internal/agiloft/execute-tool'
import { executeCursorTool } from '@/lib/internal/cursor/execute-tool'
import { presentInternalToolOperationResult } from '@/lib/internal/tool-operations/file-result.server'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import { FileToolProcessor } from '@/executor/utils/file-tool-processor'
import { agiloftRetrieveAttachmentTool } from '@/tools/agiloft/retrieve_attachment'
import { downloadArtifactTool, downloadArtifactV2Tool } from '@/tools/cursor/download_artifact'

const cases = [
  {
    tool: agiloftRetrieveAttachmentTool,
    handler: executeAgiloftTool,
    input: {
      instanceUrl: 'https://example.agiloft.com',
      knowledgeBase: 'demo',
      login: 'user',
      password: 'test-password',
      table: 'contracts',
      recordId: '1',
      fieldName: 'files',
      position: '0',
    },
  },
  {
    tool: downloadArtifactV2Tool,
    handler: executeCursorTool,
    input: { apiKey: 'test-key', agentId: 'agent-1', path: '/files/evidence.bin' },
  },
]

const context = {
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
}
const storedFile: UserFile = {
  id: 'file-1',
  key: 'execution/workspace-1/workflow-1/execution-1/file-1',
  name: 'evidence.bin',
  size: 8 * 1024 * 1024,
  type: 'application/octet-stream',
  url: '/api/files/serve/file-1',
  context: 'execution',
}
const responseOptions = { maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES, label: 'Tool response' }

function request(toolId: string, input: unknown): InternalToolOperationCall {
  return { toolId, input, context, requestId: 'request-1', headers: new Headers() }
}

describe.each(cases)('$tool.id stored output boundary', ({ tool, handler, input }) => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockReset()
    mockSecureFetchWithPinnedIP.mockReset()
    mockUploadExecutionFile.mockReset()
    mockUploadCopilotFile.mockReset()
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mockSecureFetchWithPinnedIP.mockImplementation(
      async () =>
        new Response(Buffer.alloc(8 * 1024 * 1024), {
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="evidence.bin"',
          },
        })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ url: 'https://download.example/artifact' }))
    )
    mockUploadExecutionFile.mockResolvedValue(storedFile)
    mockUploadCopilotFile.mockResolvedValue({ ...storedFile, context: 'copilot' })
  })

  it('admits an 8 MiB download and preserves its stored identity through the real transform and processor', async () => {
    const controller = new AbortController()
    const call = request(tool.id, {
      ...input,
      workspaceId: 'forged-workspace',
      userId: 'forged-user',
    })
    call.signal = controller.signal
    const response = await presentInternalToolOperationResult(
      await handler(call),
      call.context,
      call.signal
    )
    expect(response.status).toBe(200)
    const bytes = await readResponseToBufferWithLimit(response, responseOptions)
    expect(bytes.length).toBeLessThan(1024)
    if (tool.id === 'agiloft_retrieve_attachment') {
      expect(agiloftRetrieveResponseSchema.parse(JSON.parse(bytes.toString())).output.file).toEqual(
        storedFile
      )
    }
    const transformResponse = tool.transformResponse
    if (!transformResponse) throw new Error('Download tool must transform its response')
    const transformed = await transformResponse(new Response(new Uint8Array(bytes)))
    const output = await FileToolProcessor.processToolOutputs(
      transformed.output,
      tool,
      context,
      controller.signal
    )
    expect(output.file).toEqual(storedFile)
    expect(mockUploadExecutionFile).toHaveBeenCalledExactlyOnceWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      expect.any(Buffer),
      'evidence.bin',
      'application/octet-stream',
      'user-1'
    )
    expect(mockUploadExecutionFile.mock.calls[0]?.[1].length).toBe(8 * 1024 * 1024)
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
    expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.any(String),
      '203.0.113.1',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('uses the trusted delegated user for storage without an execution scope', async () => {
    const call = request(tool.id, input)
    call.context = {
      workflowId: '',
      userId: 'origin-user',
      executorDelegationOrigin: {
        subjectUserId: 'origin-user',
        workflowId: 'origin-workflow',
        executionId: 'origin-execution',
      },
    }
    expect(
      (await presentInternalToolOperationResult(await handler(call), call.context)).status
    ).toBe(200)
    expect(mockUploadCopilotFile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'origin-user' })
    )
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })

  it('allows a complete execution scope without a user identity', async () => {
    const call = request(tool.id, input)
    call.context = { ...context, userId: undefined }
    expect(
      (await presentInternalToolOperationResult(await handler(call), call.context)).status
    ).toBe(200)
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      expect.any(Buffer),
      'evidence.bin',
      'application/octet-stream',
      undefined
    )
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })

  it('rejects forged storage scope when trusted context has no owner', async () => {
    const call = request(tool.id, {
      ...input,
      workspaceId: 'forged',
      workflowId: 'forged',
      executionId: 'forged',
      userId: 'forged',
    })
    call.context = { workflowId: '' }
    await expect(
      presentInternalToolOperationResult(await handler(call), call.context)
    ).rejects.toThrow('Authentication required')
    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })

  it('surfaces storage failure without returning inline bytes', async () => {
    mockUploadExecutionFile.mockRejectedValue(new Error('Storage unavailable'))
    const call = request(tool.id, input)
    await expect(
      presentInternalToolOperationResult(await handler(call), call.context)
    ).rejects.toThrow('Storage unavailable')
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })
})

it('preserves Agiloft failure messages without manufacturing a file output', async () => {
  const transformResponse = agiloftRetrieveAttachmentTool.transformResponse
  if (!transformResponse) throw new Error('Download tool must transform its response')
  await expect(
    transformResponse(Response.json({ success: false, error: 'Attachment unavailable' }))
  ).rejects.toThrow('Attachment unavailable')
})

it('keeps Cursor v1 metadata base64 through the real handler and transform', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ url: 'https://download.example/artifact' }))
  )
  mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  mockSecureFetchWithPinnedIP.mockResolvedValue(new Response('legacy'))
  const call = request(downloadArtifactTool.id, {
    apiKey: 'test-key',
    agentId: 'agent-1',
    path: '/legacy.txt',
    persistFile: true,
  })
  call.context = { workflowId: '' }
  const response = await presentInternalToolOperationResult(
    await executeCursorTool(call),
    call.context
  )
  const transformResponse = downloadArtifactTool.transformResponse
  if (!transformResponse) throw new Error('Download tool must transform its response')
  const transformed = await transformResponse(response)
  expect(transformed.output.metadata).toEqual({
    name: 'legacy.txt',
    mimeType: 'text/plain;charset=UTF-8',
    data: Buffer.from('legacy').toString('base64'),
    size: 6,
  })
  expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  expect(mockUploadCopilotFile).not.toHaveBeenCalled()
})
