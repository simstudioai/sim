/**
 * @vitest-environment node
 */
import type { Attributes, SFTPWrapper } from 'ssh2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientEnd: vi.fn(),
  createConnection: vi.fn(),
  getSftp: vi.fn(),
  readFile: vi.fn(),
  exists: vi.fn(),
  isDirectory: vi.fn(),
  processFiles: vi.fn(),
  downloadFile: vi.fn(),
  assertFileAccess: vi.fn(),
  docNotReadyResponse: vi.fn(),
}))

vi.mock('@/lib/internal/sftp/client', () => ({
  createSftpConnection: mocks.createConnection,
  getSftp: mocks.getSftp,
  isPathSafe: (value: string) => !value.includes('../'),
  sanitizePath: (value: string) => value.trim(),
  sanitizeFileName: (value: string) => value.replaceAll('/', '_'),
  getFileType: (attributes: Attributes) =>
    (attributes.mode & 0o170000) === 0o040000 ? 'directory' : 'file',
  parsePermissions: (mode: number) => `0${(mode & 0o777).toString(8)}`,
  MAX_SFTP_READ_BYTES: 50 * 1024 * 1024,
  readSftpFileCapped: mocks.readFile,
  sftpExists: mocks.exists,
  sftpIsDirectory: mocks.isDirectory,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  getFileExtension: (name: string) => name.split('.').pop() ?? '',
  getMimeTypeFromExtension: () => 'text/plain',
  processFilesToUserFiles: mocks.processFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadFile,
}))

vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: mocks.docNotReadyResponse,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertFileAccess,
}))

import {
  executeSftpDownload,
  executeSftpList,
  executeSftpUpload,
} from '@/lib/internal/sftp/operations'

const connectionInput = {
  host: 'sftp.example.com',
  port: 22,
  username: 'user',
  password: 'secret',
  privateKey: null,
  passphrase: null,
}
const context = { userId: 'user-1', requestId: 'request-1' }

describe('SFTP operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createConnection.mockResolvedValue({ end: mocks.clientEnd })
    mocks.assertFileAccess.mockResolvedValue(null)
    mocks.docNotReadyResponse.mockReturnValue(null)
  })

  it('returns the historical list shape and sorts directories first', async () => {
    const sftp = {
      readdir: vi.fn((_path, callback) =>
        callback(null, [
          { filename: 'z.txt', attrs: { mode: 0o100644, size: 4, mtime: 1 } },
          { filename: 'folder', attrs: { mode: 0o040755, size: 0, mtime: 2 } },
          { filename: '.', attrs: { mode: 0o040755, size: 0, mtime: 2 } },
        ])
      ),
    } as unknown as SFTPWrapper
    mocks.getSftp.mockResolvedValue(sftp)

    const response = await executeSftpList(
      { ...connectionInput, remotePath: '/files', detailed: true },
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      path: '/files',
      entries: [
        {
          name: 'folder',
          type: 'directory',
          size: 0,
          permissions: '0755',
          modifiedAt: new Date(2000).toISOString(),
        },
        {
          name: 'z.txt',
          type: 'file',
          size: 4,
          permissions: '0644',
          modifiedAt: new Date(1000).toISOString(),
        },
      ],
      count: 2,
      message: 'Found 2 entries in /files',
    })
    expect(mocks.clientEnd).toHaveBeenCalledOnce()
  })

  it('rejects declared downloads over 50MB before opening a read stream', async () => {
    const sftp = {
      stat: vi.fn((_path, callback) => callback(null, { size: 50 * 1024 * 1024 + 1 })),
    } as unknown as SFTPWrapper
    mocks.getSftp.mockResolvedValue(sftp)

    const response = await executeSftpDownload(
      { ...connectionInput, remotePath: '/huge.bin', encoding: 'base64' },
      context
    )

    expect(response.status).toBe(413)
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.clientEnd).toHaveBeenCalledOnce()
  })

  it('authorizes every referenced Sim file before reading or uploading it', async () => {
    const denied = Response.json({ success: false, error: 'File not found' }, { status: 404 })
    const file = { key: 'workspace/file', name: 'private.txt', size: 4 }
    mocks.getSftp.mockResolvedValue({} as SFTPWrapper)
    mocks.processFiles.mockReturnValue([file])
    mocks.assertFileAccess.mockResolvedValue(denied)

    const response = await executeSftpUpload(
      {
        ...connectionInput,
        remotePath: '/files',
        files: [file],
        fileContent: null,
        fileName: null,
        overwrite: true,
        permissions: null,
      },
      context
    )

    expect(response.status).toBe(404)
    expect(mocks.assertFileAccess).toHaveBeenCalledWith(
      'workspace/file',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.clientEnd).toHaveBeenCalledOnce()
  })
})
