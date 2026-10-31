import { mkdir, mkdtemp, realpath, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import {
  executeLocalFileRequest as executeApprovedLocalFileRequest,
  type LocalFileAuthorization,
} from '@/main/local-files'
import { type openNativeFile, openPosixNativeFile } from '@/main/native-directory'
import { openWin32NativeFile } from '@/main/win32-native-files'

const isWindows = process.platform === 'win32'

/** Both backends run where they can; the POSIX native module is not built on Windows. */
const BACKENDS: Array<[string, typeof openNativeFile]> = [['Windows', openWin32NativeFile]]
if (!isWindows) BACKENDS.push(['POSIX', openPosixNativeFile])

/** A junction on Windows, which needs no privilege; a symlink elsewhere. */
function linkDirectory(target: string, path: string) {
  return symlink(target, path, isWindows ? 'junction' : 'dir')
}

/** File symlinks need Developer Mode or elevation on Windows. */
async function canLinkFiles(): Promise<boolean> {
  const probe = await mkdtemp(join(tmpdir(), 'sim-symlink-probe-'))
  try {
    await writeFile(join(probe, 'target'), '')
    await symlink(join(probe, 'target'), join(probe, 'link'), 'file')
    return true
  } catch {
    return false
  } finally {
    await rm(probe, { recursive: true, force: true })
  }
}

const fileLinks = await canLinkFiles()

describe.each(BACKENDS)('local file requests on the %s backend', (_name, openBeneath) => {
  /** Parser and import invariants run with explicit fixture access; consent is covered through Electron. */
  function executeLocalFileRequest(request: unknown, authorization: LocalFileAuthorization) {
    return executeApprovedLocalFileRequest(request, authorization, {
      path: String(authorization.args.path),
      resolve: realpath,
      open: async (path, directory = false) =>
        openBeneath(root, relative(root, path), await stat(root, { bigint: true }), directory),
    })
  }

  let root: string
  beforeEach(async () => {
    vi.mocked(app.getAppPath).mockReturnValue(fileURLToPath(new URL('../..', import.meta.url)))
    root = await realpath(await mkdtemp(join(tmpdir(), 'sim-native-files-')))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('rejects missing paths and directory cycles with explicit errors before uploading', async () => {
    expect(
      await executeLocalFileRequest(
        { operation: 'read' },
        { toolName: 'read_local_file', args: { path: join(root, 'missing') } }
      )
    ).toMatchObject({ ok: false })
    await linkDirectory(root, join(root, 'cycle'))
    expect(
      await executeLocalFileRequest(
        { operation: 'manifest' },
        { toolName: 'import_local_files', args: { path: root, targetWorkspaceId: 'target' } }
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining('cycle') })
  })

  it('refuses oversized import files before any workspace mutation or bulk allocation', async () => {
    const path = join(root, 'large.bin')
    await writeFile(path, '')
    await truncate(path, 64 * 1024 * 1024 + 1)
    expect(
      await executeLocalFileRequest(
        { operation: 'manifest' },
        { toolName: 'import_local_files', args: { path, targetWorkspaceId: 'workspace' } }
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining('64 MB') })
  })

  it.for(['file', 'directory'] as const)(
    'rejects %s symlinks outside the import source during manifest and chunk reads',
    async (kind, { skip }) => {
      if (kind === 'file' && !fileLinks)
        skip('creating file symlinks needs Developer Mode or elevation')
      const source = join(root, 'selected')
      const outside = join(root, 'selected-other')
      await mkdir(source)
      await mkdir(outside)
      await writeFile(join(outside, 'private.txt'), 'outside content')
      const target = kind === 'file' ? join(outside, 'private.txt') : outside
      await (kind === 'file'
        ? symlink(target, join(source, 'link'), 'file')
        : linkDirectory(target, join(source, 'link')))
      const authorization = {
        toolName: 'import_local_files',
        args: { path: source, targetWorkspaceId: 'target' },
      }
      expect(await executeLocalFileRequest({ operation: 'manifest' }, authorization)).toMatchObject(
        {
          ok: false,
          error: expect.stringContaining('outside this import source'),
        }
      )
      const outsideManifest = await executeLocalFileRequest(
        { operation: 'manifest' },
        { toolName: 'import_local_files', args: { path: target, targetWorkspaceId: 'target' } }
      )
      if (!outsideManifest.ok || outsideManifest.data.kind !== 'manifest')
        throw new Error('Expected manifest')
      const entry = outsideManifest.data.entries.find((item) => item.kind === 'file')!
      expect(
        await executeLocalFileRequest(
          {
            operation: 'chunk',
            relativePath: kind === 'file' ? 'link' : 'link/private.txt',
            revision: entry.revision,
            offset: 0,
          },
          authorization
        )
      ).toMatchObject({ ok: false, error: expect.stringContaining('outside this import source') })
    }
  )

  it.runIf(fileLinks)(
    'supports internal symlinks and an explicitly selected symlink root, but rejects a retargeted child',
    async () => {
      const source = join(root, 'selected')
      await mkdir(source)
      await writeFile(join(source, 'notes.txt'), 'inside')
      await symlink(join(source, 'notes.txt'), join(source, 'alias.txt'), 'file')
      const selectedAlias = join(root, 'selected-alias')
      await linkDirectory(source, selectedAlias)
      const authorization = {
        toolName: 'import_local_files',
        args: { path: selectedAlias, targetWorkspaceId: 'target' },
      }
      const manifest = await executeLocalFileRequest({ operation: 'manifest' }, authorization)
      if (!manifest.ok || manifest.data.kind !== 'manifest') throw new Error('Expected manifest')
      const entry = manifest.data.entries.find((item) => item.relativePath === 'alias.txt')!
      const request = {
        operation: 'chunk',
        relativePath: 'alias.txt',
        revision: entry.revision,
        offset: 0,
      }
      expect(await executeLocalFileRequest(request, authorization)).toEqual({
        ok: true,
        data: { kind: 'chunk', bytes: new Uint8Array(Buffer.from('inside')), eof: true },
      })
      await writeFile(join(root, 'outside.txt'), 'outside')
      await rm(join(source, 'alias.txt'))
      await symlink(join(root, 'outside.txt'), join(source, 'alias.txt'), 'file')
      expect(await executeLocalFileRequest(request, authorization)).toMatchObject({
        ok: false,
        error: expect.stringContaining('outside this import source'),
      })
    }
  )

  it('preserves a UTF-8 BOM and rejects split offsets and limits that cannot fit a character', async () => {
    const path = join(root, 'unicode.txt')
    await writeFile(path, '\uFEFF😀end')
    expect(
      await executeLocalFileRequest(
        { operation: 'read' },
        {
          toolName: 'read_local_file',
          args: { path, limit: 4 },
        }
      )
    ).toMatchObject({ ok: true, data: { text: '\uFEFF', nextOffset: 3, truncated: true } })
    expect(
      await executeLocalFileRequest(
        { operation: 'read' },
        {
          toolName: 'read_local_file',
          args: { path, offset: 4 },
        }
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining('UTF-8') })
    expect(
      await executeLocalFileRequest(
        { operation: 'read' },
        {
          toolName: 'read_local_file',
          args: { path, offset: 3, limit: 1 },
        }
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining('limit') })
  })
})
