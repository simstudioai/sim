/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { executeSftpTool } from '@/lib/internal/sftp/execute-tool'
import { sftpDeleteTool } from '@/tools/sftp/delete'
import { sftpDownloadTool } from '@/tools/sftp/download'
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

describe('SFTP tool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const execute of Object.values(mocks)) {
      execute.mockResolvedValue(Response.json({ success: true }))
    }
  })

  it.each([
    ['sftp_delete', mocks.executeDelete],
    ['sftp_download', mocks.executeDownload],
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
      sftpListTool,
      sftpMkdirTool,
      sftpUploadTool,
    ]) {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
    }
  })
})
