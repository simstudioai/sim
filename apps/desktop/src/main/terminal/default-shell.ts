/**
 * Picks the shell a new terminal tab launches.
 *
 * POSIX hosts publish the user's login shell in `$SHELL`. Windows has no such
 * convention: `COMSPEC` names cmd.exe, which is the shell of last resort, so
 * PowerShell is preferred when it is installed — pwsh (PowerShell 7) first,
 * then the Windows PowerShell 5.1 that ships with every supported Windows.
 * Git for Windows' bash is offered as an alternative when it is installed,
 * because the bash shell-integration hooks work in it unchanged.
 */
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

export type WindowsTerminalShell = 'powershell' | 'git-bash'

export const WINDOWS_TERMINAL_SHELLS: readonly WindowsTerminalShell[] = ['powershell', 'git-bash']

export function isWindowsTerminalShell(value: unknown): value is WindowsTerminalShell {
  return value === 'powershell' || value === 'git-bash'
}

const WINDOWS_POWERSHELL_CANDIDATES = ['pwsh.exe', 'powershell.exe'] as const

/**
 * The shell the next Windows terminal launches. Process-wide rather than
 * threaded through every service because the choice is a device preference,
 * like the terminal theme, and every chat scope's shells share it.
 */
let preferredWindowsShell: WindowsTerminalShell = 'powershell'

export function setPreferredWindowsShell(shell: WindowsTerminalShell): void {
  preferredWindowsShell = shell
}

export function getPreferredWindowsShell(): WindowsTerminalShell {
  return preferredWindowsShell
}

function findOnPath(executable: string, env: NodeJS.ProcessEnv): string | null {
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, executable)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Git for Windows' bash, or null when Git is not installed.
 *
 * Only Git's own install locations are checked. A bare `bash.exe` on PATH is
 * not trusted: `C:\Windows\System32\bash.exe` is the WSL launcher, which runs
 * a Linux VM rather than a shell on this machine.
 */
export function findGitBash(env: NodeJS.ProcessEnv = process.env): string | null {
  const roots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramW6432,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs') : undefined,
  ]
  for (const root of roots) {
    if (!root) continue
    const candidate = join(root, 'Git', 'bin', 'bash.exe')
    if (existsSync(candidate)) return candidate
  }
  // A Git installed elsewhere still puts `cmd\git.exe` on PATH; bash sits
  // beside it in the install's `bin`.
  const git = findOnPath('git.exe', env)
  if (git) {
    const candidate = join(dirname(dirname(git)), 'bin', 'bash.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function findPowerShell(env: NodeJS.ProcessEnv): string | null {
  for (const executable of WINDOWS_POWERSHELL_CANDIDATES) {
    const found = findOnPath(executable, env)
    if (found) return found
  }
  return null
}

export function defaultShellPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  preference: WindowsTerminalShell = preferredWindowsShell
): string {
  if (platform !== 'win32') {
    return env.SHELL || '/bin/zsh'
  }
  if (preference === 'git-bash') {
    const gitBash = findGitBash(env)
    if (gitBash) return gitBash
  }
  return findPowerShell(env) ?? env.COMSPEC ?? 'cmd.exe'
}
