/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReportCompletion } = vi.hoisted(() => ({
  mockReportCompletion: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/client/completion', () => ({
  reportClientToolCompletion: mockReportCompletion,
}))

import { executeLocalFilesystemTool } from '@/lib/copilot/tools/client/local-filesystem'

const mount = {
  id: 'mount-1',
  name: 'Project',
  uri: 'localfs://mount-1/',
  path: '~/code/project',
  remembered: true,
}
const vfsRoot = 'user-local/Project--mount-1'

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

  it('projects granted mounts and glob results into canonical user-local VFS paths', async () => {
    localFilesystem.mockImplementation(async (request: { operation: string }) => {
      if (request.operation === 'list_mounts') {
        return { ok: true, data: { mounts: [mount] } }
      }
      if (request.operation === 'glob') {
        return {
          ok: true,
          data: {
            entries: [
              {
                name: 'index.ts',
                uri: 'localfs://mount-1/src/index.ts',
                kind: 'file',
                size: 10,
                modifiedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            truncated: false,
          },
        }
      }
      throw new Error(`Unexpected operation: ${request.operation}`)
    })

    executeLocalFilesystemTool(
      'tool-1',
      'glob',
      { pattern: 'user-local/**/*.ts' },
      { workspaceId: 'ws-1' }
    )

    await vi.waitFor(() => {
      expect(localFilesystem).toHaveBeenCalledWith({
        operation: 'glob',
        uri: 'localfs://mount-1/',
        pattern: 'user-local/**/*.ts',
        pathPrefix: vfsRoot,
        requestId: 'tool-1',
      })
      expect(mockReportCompletion).toHaveBeenCalledWith(
        'tool-1',
        'success',
        'Local filesystem tool completed.',
        { files: [`${vfsRoot}/src/index.ts`] }
      )
    })
    expect(JSON.stringify(mockReportCompletion.mock.calls)).not.toContain('localfs://')
    expect(JSON.stringify(mockReportCompletion.mock.calls)).not.toContain('~/code/project')
  })

  it('maps ordinary VFS read arguments to a bounded desktop read', async () => {
    localFilesystem.mockImplementation(async (request: { operation: string }) => {
      if (request.operation === 'list_mounts') {
        return { ok: true, data: { mounts: [mount] } }
      }
      if (request.operation === 'read') {
        return {
          ok: true,
          data: {
            uri: 'localfs://mount-1/README.md',
            content: 'second line',
            startLine: 2,
            endLine: 2,
            totalLines: 3,
          },
        }
      }
      throw new Error(`Unexpected operation: ${request.operation}`)
    })

    executeLocalFilesystemTool(
      'tool-read',
      'read',
      { path: `${vfsRoot}/README.md`, offset: 1, limit: 1 },
      { workspaceId: 'ws-1' }
    )

    await vi.waitFor(() => {
      expect(localFilesystem).toHaveBeenCalledWith({
        operation: 'read',
        uri: 'localfs://mount-1/README.md',
        startLine: 2,
        lineCount: 1,
        requestId: 'tool-read',
      })
      expect(mockReportCompletion).toHaveBeenCalledWith(
        'tool-read',
        'success',
        'Local filesystem tool completed.',
        { content: 'second line', totalLines: 3 }
      )
    })
  })

  it('preserves normal grep regex/options and rewrites every result path', async () => {
    localFilesystem.mockImplementation(async (request: { operation: string }) => {
      if (request.operation === 'list_mounts') {
        return { ok: true, data: { mounts: [mount] } }
      }
      if (request.operation === 'grep') {
        return {
          ok: true,
          data: {
            matches: [
              {
                uri: 'localfs://mount-1/src/index.ts',
                line: 7,
                text: 'const TODO = true',
              },
            ],
            truncated: false,
          },
        }
      }
      throw new Error(`Unexpected operation: ${request.operation}`)
    })

    executeLocalFilesystemTool(
      'tool-grep',
      'grep',
      {
        pattern: 'TODO|FIXME',
        path: vfsRoot,
        ignoreCase: true,
        lineNumbers: false,
        context: 2,
        maxResults: 10,
      },
      { workspaceId: 'ws-1' }
    )

    await vi.waitFor(() => {
      expect(localFilesystem).toHaveBeenCalledWith({
        operation: 'grep',
        uri: 'localfs://mount-1/',
        pattern: 'TODO|FIXME',
        caseSensitive: false,
        maxResults: 10,
        outputMode: 'content',
        lineNumbers: false,
        context: 2,
        requestId: 'tool-grep',
      })
      expect(mockReportCompletion).toHaveBeenCalledWith(
        'tool-grep',
        'success',
        'Local filesystem tool completed.',
        {
          matches: [{ path: `${vfsRoot}/src/index.ts`, line: 7, content: 'const TODO = true' }],
        }
      )
    })
  })

  it('does not let a legacy model call open a picker, revoke a grant, or upload bytes', async () => {
    for (const [id, name, args] of [
      ['mount', 'local_mount_directory', {}],
      ['forget', 'local_forget_mount', { uri: mount.uri }],
      ['stage', 'local_stage_file', { uri: `${mount.uri}README.md` }],
    ] as const) {
      executeLocalFilesystemTool(id, name, args, { workspaceId: 'ws-1' })
    }

    await vi.waitFor(() => {
      expect(mockReportCompletion).toHaveBeenCalledTimes(3)
    })
    expect(localFilesystem).not.toHaveBeenCalled()
    for (const call of mockReportCompletion.mock.calls) {
      expect(call[1]).toBe('error')
    }
  })

  it('cancels an in-flight native read on abort and never reports a stale completion', async () => {
    let finishRead:
      | ((response: { ok: false; code: 'CANCELLED'; error: string }) => void)
      | undefined
    localFilesystem.mockImplementation((request: { operation: string; requestId?: string }) => {
      if (request.operation === 'list_mounts') {
        return Promise.resolve({ ok: true, data: { mounts: [mount] } })
      }
      if (request.operation === 'read') {
        return new Promise((resolve) => {
          finishRead = resolve
        })
      }
      if (request.operation === 'cancel') {
        finishRead?.({ ok: false, code: 'CANCELLED', error: 'cancelled' })
        return Promise.resolve({ ok: true, data: { cancelled: true } })
      }
      throw new Error(`Unexpected operation: ${request.operation}`)
    })
    const controller = new AbortController()

    executeLocalFilesystemTool(
      'tool-abort',
      'read',
      { path: `${vfsRoot}/README.md` },
      { workspaceId: 'ws-1', signal: controller.signal }
    )

    await vi.waitFor(() => {
      expect(localFilesystem).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'read', requestId: 'tool-abort' })
      )
    })
    controller.abort('user stopped')

    await vi.waitFor(() => {
      expect(localFilesystem).toHaveBeenCalledWith({
        operation: 'cancel',
        requestId: 'tool-abort',
      })
    })
    expect(mockReportCompletion).not.toHaveBeenCalled()
  })
})
