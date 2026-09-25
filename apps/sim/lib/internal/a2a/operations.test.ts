import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { filesAuthorizationMock } from '@sim/testing/mocks/files-authorization.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildUserMessage: vi.fn(),
  createA2AClient: vi.fn(),
  isTaskResult: vi.fn(),
  messageOutput: vi.fn(),
  validateOpaqueModelInputProvenance: vi.fn(),
}))

const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockIsModelSafeWorkspaceFileKey } = workspaceFileSecretProvenanceMockFns

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
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

import { sendA2AMessage } from '@/lib/internal/a2a/operations'

describe('sendA2AMessage', () => {
  beforeEach(() => {
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({ success: true })
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
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
    expect(mockProcessFilesToUserFiles).not.toHaveBeenCalled()
    expect(mocks.createA2AClient).not.toHaveBeenCalled()
  })

  it('resolves attachments sequentially and enforces a cumulative byte budget', async () => {
    const files = [
      { key: 'workspace/ws/file-1', name: 'one.txt', size: 3, type: 'text/plain' },
      { key: 'workspace/ws/file-2', name: 'two.txt', size: 3, type: 'text/plain' },
    ]
    mockProcessFilesToUserFiles.mockReturnValue(files)
    mockDownloadServableFileFromStorage
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
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledTimes(2)
    expect(mocks.createA2AClient).not.toHaveBeenCalled()
  })
})
