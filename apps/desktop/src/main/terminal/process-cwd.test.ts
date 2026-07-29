import { describe, expect, it } from 'vitest'
import { parseLsofCwd, readProcessCwd } from '@/main/terminal/process-cwd'

describe('parseLsofCwd', () => {
  it('picks the path out of lsof field output', () => {
    expect(parseLsofCwd('p123\nfcwd\nn/Users/me/project\n')).toBe('/Users/me/project')
  })

  it('keeps paths containing spaces intact', () => {
    expect(parseLsofCwd('p1\nfcwd\nn/Users/me/My Code/app\n')).toBe('/Users/me/My Code/app')
  })

  it('returns null when no path field is present', () => {
    expect(parseLsofCwd('')).toBeNull()
    expect(parseLsofCwd('p123\nfcwd\n')).toBeNull()
    // A field line that is not an absolute path is not a cwd.
    expect(parseLsofCwd('p123\nnrelative/path\n')).toBeNull()
  })
})

describe('readProcessCwd', () => {
  it('rejects invalid pids without touching the OS', async () => {
    await expect(readProcessCwd(0)).resolves.toBeNull()
    await expect(readProcessCwd(-1)).resolves.toBeNull()
    await expect(readProcessCwd(Number.NaN)).resolves.toBeNull()
  })

  it('resolves this process to a real directory', async () => {
    const cwd = await readProcessCwd(process.pid)
    // Unsupported platforms report null rather than guessing.
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      expect(cwd).toBeNull()
      return
    }
    expect(cwd?.startsWith('/')).toBe(true)
  })

  it('returns null for a pid that does not exist', async () => {
    await expect(readProcessCwd(2_147_483_600)).resolves.toBeNull()
  })
})
