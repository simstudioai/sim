/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  buildUserMessage: vi.fn(),
  createA2AClient: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
  isTaskResult: vi.fn(),
  messageOutput: vi.fn(),
  processFilesToUserFiles: vi.fn(),
  validateOpaqueModelInputProvenance: vi.fn(),
}))

vi.mock('@/lib/a2a/client', () => ({
  buildUserMessage: mocks.buildUserMessage,
  createA2AClient: mocks.createA2AClient,
  isTaskResult: mocks.isTaskResult,
  messageOutput: mocks.messageOutput,
  taskErrored: vi.fn(),
  taskOutput: vi.fn(),
  agentCardOutput: vi.fn(),
}))

vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateOpaqueModelInputProvenance,
}))

vi.mock('@/lib/uploads/shared/types', () => ({ MAX_BUFFERED_TRANSFER_BYTES: 5 }))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFilesToUserFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'unsafe file',
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

import { sendA2AMessage } from '@/lib/internal/a2a/operations'

describe('sendA2AMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({ success: true })
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.buildUserMessage.mockReturnValue({ messageId: 'message-1' })
    mocks.isTaskResult.mockReturnValue(false)
    mocks.messageOutput.mockReturnValue({ content: 'done' })
    mocks.createA2AClient.mockResolvedValue({
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'response-1' }),
    })
  })

  it('validates private model-input provenance before any file or provider work', async () => {
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({
      success: false,
      error: 'Model input contains a resolved secret',
      status: 400,
    })

    await expect(
      sendA2AMessage(
        { agentUrl: 'https://agent.example', message: 'Hello' },
        {
          headers: new Headers(),
          requestId: 'request-1',
          userId: 'user-1',
        }
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(mocks.processFilesToUserFiles).not.toHaveBeenCalled()
    expect(mocks.createA2AClient).not.toHaveBeenCalled()
  })

  it('resolves attachments sequentially and enforces a cumulative byte budget', async () => {
    const files = [
      { key: 'workspace/ws/file-1', name: 'one.txt', size: 3, type: 'text/plain' },
      { key: 'workspace/ws/file-2', name: 'two.txt', size: 3, type: 'text/plain' },
    ]
    mocks.processFilesToUserFiles.mockReturnValue(files)
    mocks.downloadServableFileFromStorage
      .mockResolvedValueOnce({ buffer: Buffer.from('one'), contentType: 'text/plain' })
      .mockResolvedValueOnce({ buffer: Buffer.from('two'), contentType: 'text/plain' })

    await expect(
      sendA2AMessage(
        {
          agentUrl: 'https://agent.example',
          message: 'Hello',
          files: [{ key: files[0].key }, { key: files[1].key }],
        },
        {
          headers: new Headers(),
          requestId: 'request-1',
          userId: 'user-1',
        }
      )
    ).rejects.toMatchObject({ name: 'PayloadSizeLimitError' })
    expect(mocks.downloadServableFileFromStorage).toHaveBeenCalledTimes(2)
    expect(mocks.createA2AClient).not.toHaveBeenCalled()
  })

  it('parses structured data and returns a direct A2A message', async () => {
    const result = await sendA2AMessage(
      {
        agentUrl: 'https://agent.example',
        message: 'Hello',
        data: '{"kind":"probe"}',
      },
      {
        headers: new Headers(),
        requestId: 'request-1',
        userId: 'user-1',
      }
    )

    expect(mocks.buildUserMessage).toHaveBeenCalledWith({
      text: 'Hello',
      data: { kind: 'probe' },
      files: undefined,
      taskId: undefined,
      contextId: undefined,
    })
    expect(result).toEqual({ success: true, output: { content: 'done' } })
  })
})
