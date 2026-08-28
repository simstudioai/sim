/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  clickupUpload: vi.fn(),
  dataverseUpload: vi.fn(),
  discordSend: vi.fn(),
  downloadPipedriveFile: vi.fn(),
  downloadServableFile: vi.fn(),
  downloadServableFiles: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
  linqRegister: vi.fn(),
  linqUpload: vi.fn(),
  listPipedriveFiles: vi.fn(),
  processFiles: vi.fn(),
  processSingleFile: vi.fn(),
  serviceNowUpload: vi.fn(),
  validateOpaqueModelInputProvenance: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  getFileExtension: (name: string) => name.split('.').pop() || '',
  getMimeTypeFromExtension: () => 'application/octet-stream',
  processFilesToUserFiles: mocks.processFiles,
  processSingleFileToUserFile: mocks.processSingleFile,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFile,
  downloadServableFilesWithinBudget: mocks.downloadServableFiles,
}))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateOpaqueModelInputProvenance,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'File may contain private data',
}))
vi.mock('@/lib/internal/clickup/client', () => ({
  uploadClickUpAttachment: mocks.clickupUpload,
}))
vi.mock('@/lib/internal/discord/client', () => ({ sendDiscordMessage: mocks.discordSend }))
vi.mock('@/lib/internal/linq/client', () => ({
  registerLinqAttachment: mocks.linqRegister,
  uploadLinqAttachmentBytes: mocks.linqUpload,
}))
vi.mock('@/lib/internal/microsoft-dataverse/client', () => ({
  uploadDataverseFile: mocks.dataverseUpload,
}))
vi.mock('@/lib/internal/servicenow/client', () => ({
  uploadServiceNowAttachment: mocks.serviceNowUpload,
}))
vi.mock('@/lib/internal/pipedrive/client', () => ({
  downloadPipedriveFile: mocks.downloadPipedriveFile,
  listPipedriveFiles: mocks.listPipedriveFiles,
}))

import { executeClickUpUploadAttachment } from '@/lib/internal/clickup/operations'
import { executeDiscordSendMessage } from '@/lib/internal/discord/operations'
import type { LinqOperationError } from '@/lib/internal/linq/errors'
import { executeLinqCreateAttachment } from '@/lib/internal/linq/operations'
import { executeDataverseUploadFile } from '@/lib/internal/microsoft-dataverse/operations'
import { executePipedriveGetFiles } from '@/lib/internal/pipedrive/operations'
import type { ServiceNowOperationError } from '@/lib/internal/servicenow/errors'
import { executeServiceNowUploadAttachment } from '@/lib/internal/servicenow/operations'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const FILE = {
  id: 'file-1',
  key: 'workspace/workspace-1/file-1',
  name: 'document.txt',
  size: 3,
  type: 'text/plain',
  url: 'https://files.example/document.txt',
}

describe('file and message operation security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.processFiles.mockReturnValue([FILE])
    mocks.processSingleFile.mockReturnValue(FILE)
    mocks.downloadServableFile.mockResolvedValue({
      buffer: Buffer.from('abc'),
      contentType: 'text/plain',
    })
    mocks.downloadServableFiles.mockResolvedValue([
      { buffer: Buffer.from('abc'), contentType: 'text/plain' },
    ])
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({ success: true })
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.clickupUpload.mockResolvedValue({ id: 'attachment-1' })
    mocks.discordSend.mockResolvedValue({ id: 'message-1', content: 'hello' })
    mocks.linqRegister.mockResolvedValue({
      attachmentId: 'attachment-1',
      downloadUrl: null,
      httpMethod: 'PUT',
      requiredHeaders: {},
      uploadUrl: 'https://upload.example/file',
    })
    mocks.linqUpload.mockResolvedValue(undefined)
    mocks.dataverseUpload.mockResolvedValue(undefined)
    mocks.serviceNowUpload.mockResolvedValue(null)
    mocks.listPipedriveFiles.mockResolvedValue({ files: [], hasMore: false, nextStart: null })
  })

  it('authorizes ClickUp files and forwards one cancellation signal through materialization', async () => {
    const controller = new AbortController()
    await executeClickUpUploadAttachment(
      { accessToken: 'token', taskId: 'task-1', file: FILE },
      { requestId: 'request-1', signal: controller.signal, userId: 'user-1' }
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      FILE.key,
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadServableFile).toHaveBeenCalledWith(
      FILE,
      'request-1',
      expect.anything(),
      expect.objectContaining({ signal: controller.signal })
    )
    expect(mocks.clickupUpload).toHaveBeenCalledWith(
      'token',
      'task-1',
      expect.any(FormData),
      controller.signal
    )
  })

  it('uses sequential authorization before Discord bounded materialization', async () => {
    const secondFile = { ...FILE, id: 'file-2', key: 'workspace/workspace-1/file-2' }
    mocks.processFiles.mockReturnValue([FILE, secondFile])
    mocks.downloadServableFiles.mockResolvedValue([
      { buffer: Buffer.from('abc'), contentType: 'text/plain' },
      { buffer: Buffer.from('def'), contentType: 'text/plain' },
    ])

    await executeDiscordSendMessage(
      {
        botToken: 'token',
        channelId: '123456789012345678',
        content: 'hello',
        files: [FILE, secondFile],
      },
      { requestId: 'request-1', userId: 'user-1' }
    )

    expect(mocks.assertToolFileAccess.mock.calls.map(([key]) => key)).toEqual([
      FILE.key,
      secondFile.key,
    ])
    expect(mocks.downloadServableFiles).toHaveBeenCalledWith(
      [FILE, secondFile],
      'request-1',
      expect.anything(),
      expect.objectContaining({ totalMaxBytes: MAX_BUFFERED_TRANSFER_BYTES })
    )
  })

  it('fails Linq private provenance before reading protected files', async () => {
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({
      success: false,
      error: 'Resolved-secret provenance mismatch',
      status: 403,
    })

    await expect(
      executeLinqCreateAttachment(
        { apiKey: 'key', file: FILE },
        { headers: new Headers(), requestId: 'request-1', userId: 'user-1' }
      )
    ).rejects.toEqual(expect.objectContaining<LinqOperationError>({ status: 403 }))
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
  })

  it('preserves Dataverse legacy base64 while forwarding cancellation to the provider', async () => {
    const controller = new AbortController()
    await executeDataverseUploadFile(
      {
        accessToken: 'token',
        environmentUrl: 'https://org.crm.dynamics.com',
        entitySetName: 'accounts',
        recordId: 'record-1',
        fileColumn: 'document',
        fileName: 'a.txt',
        fileContent: 'YQ==',
      },
      { requestId: 'request-1', signal: controller.signal, userId: 'user-1' }
    )

    expect(mocks.dataverseUpload).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'a.txt' }),
      Buffer.from('a'),
      controller.signal
    )
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
  })

  it('keeps the exact ServiceNow missing-file contract', async () => {
    await expect(
      executeServiceNowUploadAttachment(
        {
          instanceUrl: 'https://example.service-now.com',
          username: 'user',
          password: 'password',
          tableName: 'incident',
          recordSysId: 'record-1',
          fileName: 'a.txt',
        },
        { requestId: 'request-1', userId: 'user-1' }
      )
    ).rejects.toEqual(
      expect.objectContaining<ServiceNowOperationError>({
        message: 'A file is required',
        status: 400,
      })
    )
  })

  it('downloads Pipedrive files sequentially within one aggregate byte budget', async () => {
    mocks.listPipedriveFiles.mockResolvedValue({
      files: [
        { id: 1, name: 'one.txt', url: 'https://files.pipedrive.com/one' },
        { id: 2, name: 'two.txt', url: 'https://files.pipedrive.com/two' },
      ],
      hasMore: true,
      nextStart: 2,
    })
    mocks.downloadPipedriveFile
      .mockResolvedValueOnce({ buffer: Buffer.from('abc'), contentType: 'text/plain' })
      .mockResolvedValueOnce({ buffer: Buffer.from('defg'), contentType: 'text/plain' })

    const result = await executePipedriveGetFiles(
      { accessToken: 'token', downloadFiles: true },
      { requestId: 'request-1' }
    )

    expect(mocks.downloadPipedriveFile.mock.calls.map((call) => call[2])).toEqual([
      MAX_BUFFERED_TRANSFER_BYTES,
      MAX_BUFFERED_TRANSFER_BYTES - 3,
    ])
    expect(result.output.downloadedFiles).toHaveLength(2)
  })
})
