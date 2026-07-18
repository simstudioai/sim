/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReportCompletion, mockRequestJson, mockRunUploadStrategy, mockUploadViaApiFallback } =
  vi.hoisted(() => ({
    mockReportCompletion: vi.fn(),
    mockRequestJson: vi.fn(),
    mockRunUploadStrategy: vi.fn(),
    mockUploadViaApiFallback: vi.fn(),
  }))

vi.mock('@/lib/copilot/tools/client/completion', () => ({
  reportClientToolCompletion: mockReportCompletion,
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))
vi.mock('@/lib/uploads/client/direct-upload', () => ({
  DirectUploadError: class DirectUploadError extends Error {
    constructor(
      message: string,
      public code: string
    ) {
      super(message)
    }
  },
  runUploadStrategy: mockRunUploadStrategy,
}))
vi.mock('@/lib/uploads/client/api-fallback', () => ({
  uploadViaApiFallback: mockUploadViaApiFallback,
}))

import { executeLocalFilesystemTool } from '@/lib/copilot/tools/client/local-filesystem'

describe('executeLocalFilesystemTool', () => {
  const localFilesystem = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'simDesktop', {
      configurable: true,
      value: { localFilesystem },
    })
    mockReportCompletion.mockResolvedValue(undefined)
  })

  it('executes read-only tools through the desktop bridge and reports the result', async () => {
    localFilesystem.mockResolvedValue({
      ok: true,
      data: {
        mounts: [
          {
            id: 'mount-1',
            name: 'project',
            uri: 'localfs://mount-1/',
            remembered: true,
          },
        ],
      },
    })

    executeLocalFilesystemTool('tool-1', 'local_list_mounts', {}, { workspaceId: 'ws-1' })

    await vi.waitFor(() => {
      expect(mockReportCompletion).toHaveBeenCalledWith(
        'tool-1',
        'success',
        'Local filesystem tool completed.',
        {
          mounts: [
            {
              id: 'mount-1',
              name: 'project',
              uri: 'localfs://mount-1/',
              remembered: true,
            },
          ],
        }
      )
    })
  })

  it('forgets a remembered mount through the desktop bridge', async () => {
    localFilesystem.mockResolvedValue({
      ok: true,
      data: { forgotten: true },
    })

    executeLocalFilesystemTool(
      'tool-forget',
      'local_forget_mount',
      { uri: 'localfs://mount-1/' },
      { workspaceId: 'ws-1' }
    )

    await vi.waitFor(() => {
      expect(localFilesystem).toHaveBeenCalledWith({
        operation: 'forget_mount',
        uri: 'localfs://mount-1/',
      })
      expect(mockReportCompletion).toHaveBeenCalledWith(
        'tool-forget',
        'success',
        'Local filesystem tool completed.',
        { forgotten: true }
      )
    })
  })

  it('uploads a local file, links it to the chat, and returns the materialization handoff', async () => {
    localFilesystem.mockResolvedValue({
      ok: true,
      data: {
        uri: 'localfs://mount-1/report.txt',
        name: 'report.txt',
        size: 5,
        bytes: new Uint8Array([104, 101, 108, 108, 111]),
      },
    })
    mockRunUploadStrategy.mockResolvedValue({ key: 'storage-key' })
    mockRequestJson.mockResolvedValue({
      success: true,
      displayName: 'report.txt',
      fileName: 'report.txt',
      uploadPath: 'uploads/report.txt',
    })

    executeLocalFilesystemTool(
      'tool-2',
      'local_stage_file',
      { uri: 'localfs://mount-1/report.txt' },
      { workspaceId: 'ws-1', chatId: 'chat-1' }
    )

    await vi.waitFor(() => {
      expect(mockRequestJson).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: { workspaceId: 'ws-1', chatId: 'chat-1', key: 'storage-key' },
        })
      )
      expect(mockReportCompletion).toHaveBeenCalledWith(
        'tool-2',
        'success',
        'Local filesystem tool completed.',
        expect.objectContaining({
          sourceUri: 'localfs://mount-1/report.txt',
          uploadPath: 'uploads/report.txt',
          fileName: 'report.txt',
          nextStep: expect.stringContaining('materialize_file'),
        })
      )
    })
  })

  it('reports bridge errors without exposing a host path', async () => {
    localFilesystem.mockResolvedValue({
      ok: false,
      code: 'ACCESS_DENIED',
      error: 'The requested path is outside the selected folder.',
    })

    executeLocalFilesystemTool(
      'tool-3',
      'local_read',
      { uri: 'localfs://mount-1/link' },
      { workspaceId: 'ws-1' }
    )

    await vi.waitFor(() => {
      expect(mockReportCompletion).toHaveBeenCalledWith(
        'tool-3',
        'error',
        'The requested path is outside the selected folder.',
        { error: 'The requested path is outside the selected folder.' }
      )
    })
  })
})
