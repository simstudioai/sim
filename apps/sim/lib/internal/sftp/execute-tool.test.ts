/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({
  executeDelete: vi.fn(),
  executeDownload: vi.fn(),
  executeList: vi.fn(),
  executeMkdir: vi.fn(),
  executeUpload: vi.fn(),
}))

vi.mock('@/lib/internal/sftp/operations', () => ({
  executeSftpDelete: mocks.executeDelete,
  executeSftpDownload: mocks.executeDownload,
  executeSftpList: mocks.executeList,
  executeSftpMkdir: mocks.executeMkdir,
  executeSftpUpload: mocks.executeUpload,
}))

import { executeSftpTool as executeSftpToolOperation } from '@/lib/internal/sftp/execute-tool'
import { sftpDeleteTool } from '@/tools/sftp/delete'
import { sftpDownloadTool, sftpDownloadV2Tool } from '@/tools/sftp/download'
import { sftpListTool } from '@/tools/sftp/list'
import { sftpMkdirTool } from '@/tools/sftp/mkdir'
import { sftpUploadTool } from '@/tools/sftp/upload'

const baseInput = {
  host: 'sftp.example.com',
  port: 22,
  username: 'user',
  password: 'secret',
  remotePath: '/files',
}

async function executeSftpTool(
  request: Parameters<typeof executeSftpToolOperation>[0]
): Promise<Response> {
  const result = await executeSftpToolOperation(request)
  if (!(result instanceof Response)) throw new Error('Expected a JSON response')
  return result
}

describe('SFTP tool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const execute of Object.values(mocks)) {
      execute.mockResolvedValue(Response.json({ success: true }))
    }
  })

  it('forwards binary file results without serializing them', async () => {
    const result = createInternalToolFileResult(
      { buffer: Buffer.from('file'), name: 'file.txt', mimeType: 'text/plain' },
      (file) => ({ file })
    )
    mocks.executeDownload.mockResolvedValueOnce(result)
    expect(
      await executeSftpToolOperation({
        toolId: 'sftp_download_v2',
        input: baseInput,
        headers: new Headers(),
        context: { userId: 'user-1' },
        requestId: 'request-1',
      })
    ).toBe(result)
    expect(mocks.executeDownload.mock.calls[0][0]).toEqual(baseInput)
    expect(mocks.executeDownload.mock.calls[0][2]).toBe('v2')
  })

  it.each([
    ['sftp_delete', mocks.executeDelete],
    ['sftp_download', mocks.executeDownload],
    ['sftp_download_v2', mocks.executeDownload],
    ['sftp_list', mocks.executeList],
    ['sftp_mkdir', mocks.executeMkdir],
    ['sftp_upload', mocks.executeUpload],
  ])('dispatches %s through the typed operation', async (toolId, execute) => {
    await executeSftpTool({
      toolId,
      input:
        toolId === 'sftp_upload'
          ? { ...baseInput, fileName: 'note.txt', fileContent: 'hello' }
          : baseInput,
      headers: new Headers(),
      context: { userId: 'user-1' },
      requestId: 'request-1',
    })

    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][1]).toMatchObject({ userId: 'user-1', requestId: 'request-1' })
  })

  it('rejects missing credentials before any operation runs', async () => {
    const response = await executeSftpTool({
      toolId: 'sftp_list',
      input: { ...baseInput, password: undefined },
      headers: new Headers(),
      context: { userId: 'user-1' },
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    expect(mocks.executeList).not.toHaveBeenCalled()
  })

  it('uses operation-only declarations with no HTTP-shaped request metadata', () => {
    for (const tool of [
      sftpDeleteTool,
      sftpDownloadTool,
      sftpDownloadV2Tool,
      sftpListTool,
      sftpMkdirTool,
      sftpUploadTool,
    ]) {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
    }
  })
})
