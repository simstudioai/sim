import { describe, expect, it } from 'vitest'
import type { LocalFilesystemRequest, LocalFilesystemResponse } from './index'
import { runUserLocalFilesystemTool } from './local-filesystem-tools'

const mount = { id: 'mount-1', name: 'Project', uri: 'localfs://mount-1/', remembered: true }

function context(globTruncated: boolean) {
  return {
    vfsRoot: () => 'user-local/Project--mount-1',
    invoke: async (request: LocalFilesystemRequest): Promise<LocalFilesystemResponse> => {
      if (request.operation === 'list_mounts') return { ok: true, data: { mounts: [mount] } }
      return {
        ok: true,
        data: {
          entries: [
            {
              name: 'a.ts',
              uri: 'localfs://mount-1/a.ts',
              kind: 'file',
              size: 1,
              modifiedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          truncated: globTruncated,
        },
      }
    },
  }
}

describe('user-local glob', () => {
  it('says when the folder scan stopped early, so a missing file is not read as absent', async () => {
    await expect(
      runUserLocalFilesystemTool('call-1', 'glob', { pattern: 'user-local/**/*.ts' }, context(true))
    ).resolves.toEqual({ files: ['user-local/Project--mount-1/a.ts'], truncated: true })
  })

  it('reports a complete listing without the flag', async () => {
    await expect(
      runUserLocalFilesystemTool(
        'call-1',
        'glob',
        { pattern: 'user-local/**/*.ts' },
        context(false)
      )
    ).resolves.toEqual({ files: ['user-local/Project--mount-1/a.ts'] })
  })
})
