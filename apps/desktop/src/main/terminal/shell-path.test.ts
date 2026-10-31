import { describe, expect, it } from 'vitest'
import { resolveShellPath } from '@/main/terminal/shell-path'

const WINDOWS_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

/** A Windows machine whose disk holds exactly `files`. */
function windows(env: NodeJS.ProcessEnv, files: string[]) {
  return resolveShellPath({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', ...env },
    exists: (path) => files.includes(path),
  })
}

describe('resolveShellPath on Windows', () => {
  it('prefers PowerShell 7 on PATH over Windows PowerShell', () => {
    const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    expect(
      windows({ Path: 'C:\\Windows;C:\\Program Files\\PowerShell\\7\\' }, [
        pwsh,
        WINDOWS_POWERSHELL,
      ])
    ).toBe(pwsh)
  })

  it('finds PATH and SystemRoot whatever case Windows stored them in', () => {
    const pwsh = 'D:\\pwsh\\pwsh.exe'
    expect(windows({ PATH: 'D:\\pwsh' }, [pwsh])).toBe(pwsh)
    expect(
      resolveShellPath({
        platform: 'win32',
        env: { SYSTEMROOT: 'E:\\Win' },
        exists: (path) => path === 'E:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      })
    ).toBe('E:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })

  it('never takes a pwsh.exe from a relative PATH entry, which resolves against the cwd', () => {
    expect(
      windows({ Path: '.;tools' }, ['.\\pwsh.exe', 'tools\\pwsh.exe', WINDOWS_POWERSHELL])
    ).toBe(WINDOWS_POWERSHELL)
  })

  it('falls back to cmd when no PowerShell is installed', () => {
    expect(windows({ ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, [])).toBe(
      'C:\\Windows\\system32\\cmd.exe'
    )
  })

  it('runs a SHELL set to a Windows path, and ignores the POSIX one MSYS exports', () => {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    expect(windows({ SHELL: gitBash }, [gitBash, WINDOWS_POWERSHELL])).toBe(gitBash)
    expect(windows({ SHELL: '/usr/bin/bash' }, ['/usr/bin/bash', WINDOWS_POWERSHELL])).toBe(
      WINDOWS_POWERSHELL
    )
  })
})
