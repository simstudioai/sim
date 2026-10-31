import {
  mkdir,
  mkdtemp,
  open,
  opendir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { LocalFilePermissions } from '@/main/local-file-permissions'
import { LocalFilesystemService } from '@/main/local-filesystem'
import { type NativeFileHandle, openPosixNativeFile } from '@/main/native-directory'
import { isWithinRoot } from '@/main/path-containment'
import { openWin32NativeFile, type Win32NativeFileSystem } from '@/main/win32-native-files'

/*
 * How the Windows backend could fail, one test each:
 * 1. a junction inside the grant that points outside is opened, or followed by a listing;
 * 2. a file beneath a junction parent resolves outside the grant and is opened;
 * 3. a file replaced between its identity check and the open is read;
 * 4. a case-variant spelling of the grant is refused, or a case-variant sibling
 *    (`Root2` beside `Root`) is accepted;
 * 5. listing caps or the truncation flag drift from the POSIX module's;
 * 6. a directory replaced while it is listed returns the replacement's names;
 * 7. a reserved name, stream, or trailing dot reaches the filesystem;
 * 8. a directory opened as a file fails differently than on POSIX;
 * 9. a granted folder replaced since the grant is still opened.
 */

const isWindows = process.platform === 'win32'

/** Both backends run where they can; the POSIX native module is not built on Windows. */
const BACKENDS: Array<[string, typeof openWin32NativeFile]> = [['Windows', openWin32NativeFile]]
if (!isWindows) BACKENDS.push(['POSIX', openPosixNativeFile])

/** A junction on Windows, which needs no privilege; a symlink elsewhere. */
function linkDirectory(target: string, path: string) {
  return symlink(target, path, isWindows ? 'junction' : 'dir')
}

async function readAll(handle: NativeFileHandle): Promise<string> {
  try {
    const buffer = Buffer.alloc(64)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function list(handle: NativeFileHandle) {
  try {
    return await handle.readDirectory(1000)
  } finally {
    await handle.close()
  }
}

let base: string
let root: string
let outside: string

beforeEach(async () => {
  vi.mocked(app.getAppPath).mockReturnValue(fileURLToPath(new URL('../..', import.meta.url)))
  base = await realpath(await mkdtemp(join(tmpdir(), 'sim-win32-files-')))
  root = join(base, 'Root')
  outside = join(base, 'Outside')
  await mkdir(root)
  await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'outside')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function openBeneath(relativePath: string, directory = false, fs?: Win32NativeFileSystem) {
  return openWin32NativeFile(root, relativePath, await stat(root, { bigint: true }), directory, fs)
}

describe('the Windows native file backend', () => {
  it('refuses a junction inside the grant that points outside, and lists it as a link', async () => {
    await linkDirectory(outside, join(root, 'escape'))

    await expect(openBeneath('escape', true)).rejects.toThrow('within the approved folder')
    expect(await list(await openBeneath('', true))).toEqual({
      entries: [{ name: 'escape', kind: 'symlink' }],
      truncated: false,
    })
  })

  it('refuses a file whose parent is a junction leading outside the grant', async () => {
    await linkDirectory(outside, join(root, 'docs'))

    await expect(openBeneath(join('docs', 'secret.txt'))).rejects.toThrow(
      'within the approved folder'
    )
  })

  it('refuses a file replaced between its identity check and the open', async () => {
    await writeFile(join(root, 'notes.txt'), 'original')
    const replaceThenOpen: Win32NativeFileSystem = {
      open: async (path) => {
        await rename(path, join(base, 'moved.txt'))
        await writeFile(path, 'replacement')
        return open(path, 'r')
      },
      opendir,
    }

    await expect(openBeneath('notes.txt', false, replaceThenOpen)).rejects.toThrow(
      'changed while it was being opened'
    )
  })

  it.runIf(isWindows)('opens an in-root file through a case-variant spelling', async () => {
    await writeFile(join(root, 'FILE.txt'), 'inside')

    const file = await openWin32NativeFile(
      root.toLowerCase(),
      'file.txt',
      await stat(root, { bigint: true }),
      false
    )

    expect(await readAll(file)).toBe('inside')
  })

  it.runIf(isWindows)('refuses a case-variant sibling that extends the grant name', () => {
    expect(isWithinRoot('C:\\Root', 'c:\\root\\file.txt')).toBe(true)
    expect(isWithinRoot('C:\\Root', 'c:\\ROOT2\\file.txt')).toBe(false)
  })

  it('refuses a listing of a directory replaced while it was read', async () => {
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs', 'real.txt'), 'real')
    const replaceThenList: Win32NativeFileSystem = {
      open: (path) => open(path, 'r'),
      opendir: async (path) => {
        await rename(path, join(root, 'docs-before'))
        await mkdir(path)
        await writeFile(join(path, 'planted.txt'), 'planted')
        return opendir(path)
      },
    }
    const directory = await openBeneath('docs', true, replaceThenList)

    await expect(list(directory)).rejects.toThrow('changed while it was being read')
  })

  it.each([
    ['an alternate data stream', 'notes.txt:secret'],
    ['a reserved device name', 'NUL'],
    ['a reserved device name with an extension', 'con.txt'],
    ['a trailing dot', 'notes.txt.'],
    ['a trailing space', 'notes.txt '],
  ])('refuses %s in the requested path', async (_label, name) => {
    // POSIX can store these names, so only the segment check stands between them and the open.
    if (!isWindows) await writeFile(join(root, name), 'named')

    await expect(openBeneath(name)).rejects.toThrow('within the approved folder')
  })

  it.runIf(isWindows)(
    'refuses an alternate data stream in a model path before asking for consent',
    async () => {
      const service = new LocalFilesystemService({ chooseDirectory: async () => null })
      await writeFile(join(root, 'notes.txt'), 'inside')

      await expect(
        new LocalFilePermissions(service).authorize(
          { toolName: 'read_local_file', args: { path: join(root, 'notes.txt:secret') } },
          {
            parent: async () => null,
            origin: 'https://sim.ai',
            generation: 0,
            signal: new AbortController().signal,
            isCurrent: () => true,
            revalidate: async () => true,
          }
        )
      ).rejects.toThrow('is not a plain Windows file or folder name')
    }
  )
})

describe.each(BACKENDS)('the %s backend contract', (_name, openApproved) => {
  async function openDirectory() {
    return openApproved(root, '', await stat(root, { bigint: true }), true)
  }

  it('lists 1,000 entries and flags truncation once a directory holds 1,001', async () => {
    await Promise.all(
      Array.from({ length: 1001 }, (_, index) => writeFile(join(root, `${index}.txt`), ''))
    )

    const listing = await list(await openDirectory())
    expect(listing.entries).toHaveLength(1000)
    expect(listing.truncated).toBe(true)

    await unlink(join(root, '0.txt'))
    const exact = await list(await openDirectory())
    expect(exact.entries).toHaveLength(1000)
    expect(exact.truncated).toBe(false)
  })

  it('refuses a directory opened as a file with the regular-file error', async () => {
    await mkdir(join(root, 'docs'))

    await expect(
      openApproved(root, 'docs', await stat(root, { bigint: true }), false)
    ).rejects.toThrow('The approved path is not a regular file or directory.')
  })

  it('refuses a granted folder replaced since the grant', async () => {
    const granted = await stat(root, { bigint: true })
    await rename(root, join(base, 'Root-before'))
    await mkdir(root)

    await expect(openApproved(root, '', granted, true)).rejects.toThrow(
      'The approved folder changed. Request access again.'
    )
  })
})
