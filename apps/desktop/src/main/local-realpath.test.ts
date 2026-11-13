import { describe, expect, it } from 'vitest'
import { localRealpath } from '@/main/local-realpath'

/*
 * How resolving a path on Windows could reach the network before consent, one test each:
 * 1. a symlink inside the path targets a share and `realpath` follows it;
 * 2. a local link leads to a folder whose own link targets a share;
 * 3. the path resolves to a share (a mapped drive), and is granted though it can never be opened;
 * 4. the path is itself a share (a folder picked from the network in the native dialog);
 * 5. a link loop never ends.
 */

/** Windows links keyed by path, each mapped to its `readlink` target; every other path is a folder. */
function windowsFileSystem(links: Record<string, string>, resolved?: string) {
  const followed: string[] = []
  return {
    followed,
    fs: {
      lstat: async (path: string) => ({ isSymbolicLink: () => path in links }),
      readlink: async (path: string) => links[path] ?? '',
      realpath: async (path: string) => {
        followed.push(path)
        return resolved ?? path
      },
    },
  }
}

const NETWORK = 'Network locations are not supported'

describe('localRealpath on Windows', () => {
  it('refuses a symlink to a share without following it', async () => {
    const { fs, followed } = windowsFileSystem({ 'C:\\repo\\docs': '\\\\attacker\\share' })

    await expect(localRealpath('C:\\repo\\docs\\notes.txt', 'win32', fs)).rejects.toThrow(NETWORK)
    expect(followed).toEqual([])
  })

  it('refuses a chain of local links that ends at a share', async () => {
    const { fs, followed } = windowsFileSystem({
      'C:\\repo\\vendor': 'D:\\cache',
      'D:\\cache\\pkg': '//attacker/share',
    })

    await expect(localRealpath('C:\\repo\\vendor\\pkg\\a.txt', 'win32', fs)).rejects.toThrow(
      NETWORK
    )
    expect(followed).toEqual([])
  })

  it('refuses a path that resolves to a share', async () => {
    const { fs } = windowsFileSystem({}, '\\\\server\\share\\projects')

    await expect(localRealpath('Z:\\projects', 'win32', fs)).rejects.toThrow(NETWORK)
  })

  it('refuses a path that is itself a share', async () => {
    const { fs, followed } = windowsFileSystem({})

    await expect(localRealpath('\\\\server\\share', 'win32', fs)).rejects.toThrow(NETWORK)
    expect(followed).toEqual([])
  })

  it('stops a link loop', async () => {
    const { fs } = windowsFileSystem({ 'C:\\a': 'C:\\b', 'C:\\b': 'C:\\a' })

    await expect(localRealpath('C:\\a\\file.txt', 'win32', fs)).rejects.toThrow('levels of links')
  })

  it('resolves a path through local links', async () => {
    const { fs } = windowsFileSystem({ 'C:\\Users\\me\\link': 'D:\\work' }, 'D:\\work\\a.txt')

    await expect(localRealpath('C:\\Users\\me\\link\\a.txt', 'win32', fs)).resolves.toBe(
      'D:\\work\\a.txt'
    )
  })
})
