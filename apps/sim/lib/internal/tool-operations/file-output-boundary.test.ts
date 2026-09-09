/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import type { UserFile } from '@/executor/types'

const mocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
  uploadExecutionFile: vi.fn(),
  uploadCopilotFile: vi.fn(),
  downloadFileFromUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
  uploadFileFromRawData: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/copilot/copilot-file-manager', () => ({
  uploadCopilotFile: mocks.uploadCopilotFile,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromUrl: mocks.downloadFileFromUrl,
}))
vi.mock('@/lib/internal/agiloft/file-input', () => ({ resolveAgiloftAttachmentFile: vi.fn() }))

import { agiloftRetrieveResponseSchema } from '@/lib/api/contracts/tools/agiloft'
import { readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { executeAgiloftTool } from '@/lib/internal/agiloft/execute-tool'
import { executeCursorTool } from '@/lib/internal/cursor/execute-tool'
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
  ...createExecutionContext({ workflowId: 'workflow-1', executionId: 'execution-1' }),
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
const responseOptions = { maxBytes: 10 * 1024 * 1024, label: 'Tool response' }

function request(toolId: string, input: unknown): InternalToolOperationCall {
  return { toolId, input, context, requestId: 'request-1', headers: new Headers() }
}

describe.each(cases)('$tool.id stored output boundary', ({ tool, handler, input }) => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.secureFetchWithPinnedIP.mockImplementation(
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
    mocks.uploadExecutionFile.mockResolvedValue(storedFile)
    mocks.uploadCopilotFile.mockResolvedValue({ ...storedFile, context: 'copilot' })
  })

  it('admits an 8 MiB download and preserves its stored identity through the real transform and processor', async () => {
    const controller = new AbortController()
    const call = request(tool.id, {
      ...input,
      workspaceId: 'forged-workspace',
      userId: 'forged-user',
    })
    call.signal = controller.signal
    const response = await handler(call)
    expect(response.status).toBe(200)
    const bytes = await readResponseToBufferWithLimit(response, responseOptions)
    expect(bytes.length).toBeLessThan(1024)
    if (tool.id === 'agiloft_retrieve_attachment') {
      expect(agiloftRetrieveResponseSchema.parse(JSON.parse(bytes.toString())).output.file).toEqual(
        storedFile
      )
    }
    const transformed = await tool.transformResponse!(new Response(bytes))
    const output = await FileToolProcessor.processToolOutputs(transformed.output, tool, context)
    expect(output.file).toEqual(storedFile)
    expect(mocks.uploadExecutionFile).toHaveBeenCalledExactlyOnceWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      expect.any(Buffer),
      'evidence.bin',
      'application/octet-stream',
      'user-1'
    )
    expect(mocks.uploadExecutionFile.mock.calls[0][1].length).toBe(8 * 1024 * 1024)
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
    expect(mocks.downloadFileFromUrl).not.toHaveBeenCalled()
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.any(String),
      '203.0.113.1',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('uses the trusted delegated user for storage without an execution scope', async () => {
    const call = request(tool.id, input)
    call.context = {
      workflowId: '',
      userId: 'runtime-user',
      executorDelegationOrigin: {
        subjectUserId: 'origin-user',
        workflowId: 'origin-workflow',
        executionId: 'origin-execution',
      },
    }
    expect((await handler(call)).status).toBe(200)
    expect(mocks.uploadCopilotFile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'origin-user' })
    )
    expect(mocks.uploadExecutionFile).not.toHaveBeenCalled()
  })

  it('allows a complete execution scope without a user identity', async () => {
    const call = request(tool.id, input)
    call.context = { ...context, userId: undefined }
    expect((await handler(call)).status).toBe(200)
    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      expect.any(Buffer),
      'evidence.bin',
      'application/octet-stream',
      undefined
    )
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
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
    expect((await handler(call)).status).toBe(401)
    expect(mocks.secureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(mocks.uploadExecutionFile).not.toHaveBeenCalled()
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
  })

  it('surfaces storage failure without returning inline bytes', async () => {
    mocks.uploadExecutionFile.mockRejectedValue(new Error('Storage unavailable'))
    const response = await handler(request(tool.id, input))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Storage unavailable' })
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
  })
})

it('preserves Agiloft failure messages without manufacturing a file output', async () => {
  await expect(
    agiloftRetrieveAttachmentTool.transformResponse!(
      Response.json({ success: false, error: 'Attachment unavailable' })
    )
  ).rejects.toThrow('Attachment unavailable')
})

it('keeps Cursor v1 metadata base64 through the real handler and transform', async () => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ url: 'https://download.example/artifact' }))
  )
  mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  mocks.secureFetchWithPinnedIP.mockResolvedValue(new Response('legacy'))
  const call = request(downloadArtifactTool.id, {
    apiKey: 'test-key',
    agentId: 'agent-1',
    path: '/legacy.txt',
    persistFile: true,
  })
  call.context = { workflowId: '' }
  const response = await executeCursorTool(call)
  const transformed = await downloadArtifactTool.transformResponse!(response)
  expect(transformed.output.metadata).toEqual({
    name: 'legacy.txt',
    mimeType: 'text/plain;charset=UTF-8',
    data: Buffer.from('legacy').toString('base64'),
    size: 6,
  })
  expect(mocks.uploadExecutionFile).not.toHaveBeenCalled()
  expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
})
