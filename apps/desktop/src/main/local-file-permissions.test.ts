import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { nativePath } from '@/main/local-file-permissions'

const HOME = 'C:\\Users\\me'
const windowsPath = (value: string) => nativePath(value, 'win32', () => HOME)

describe('native paths on Windows', () => {
  it.each([
    ['a UNC share, which would authenticate to the host', '\\\\attacker\\share\\file.txt'],
    ['a UNC share with forward slashes', '//attacker/share/file.txt'],
    ['a \\\\?\\ verbatim path', '\\\\?\\C:\\Users\\me\\file.txt'],
    ['a \\\\.\\ device path', '\\\\.\\pipe\\secret'],
    ['a rooted path without a drive', '\\Users\\me\\file.txt'],
    ['a POSIX-style rooted path', '/Users/me/file.txt'],
    ['a drive-relative path', 'C:Users\\me'],
    ['a UNC path after the home prefix', '~\\\\attacker\\share'],
    ['a reserved device name', 'C:\\Users\\me\\CON'],
    ['a reserved device name with an extension', 'C:\\Users\\me\\nul.txt'],
    ['a numbered reserved device', 'C:\\Users\\me\\com1'],
    ['an alternate data stream', 'C:\\Users\\me\\file.txt:hidden'],
    ['a segment with a trailing dot', 'C:\\Users\\me\\file.'],
    ['a segment with a trailing space', 'C:\\Users\\me\\folder \\file.txt'],
    ['a wildcard', 'C:\\Users\\me\\*.txt'],
    ['a NUL byte', 'C:\\Users\\me\\a\0b'],
  ])('refuses %s', (_label, value) => {
    expect(() => windowsPath(value)).toThrow()
  })

  it('resolves a drive-absolute path', () => {
    expect(windowsPath('C:\\Users\\me\\notes\\..\\todo.txt')).toBe('C:\\Users\\me\\todo.txt')
    expect(windowsPath('d:/Projects/sim')).toBe('d:\\Projects\\sim')
  })

  it('resolves ~ paths under the home directory', () => {
    expect(windowsPath('~')).toBe(HOME)
    expect(windowsPath('~\\Documents\\a.txt')).toBe('C:\\Users\\me\\Documents\\a.txt')
    expect(windowsPath('~/Documents/a.txt')).toBe('C:\\Users\\me\\Documents\\a.txt')
  })

  it('cannot be walked off the drive with ..', () => {
    expect(windowsPath('C:\\..\\..\\Windows')).toBe('C:\\Windows')
  })
})
