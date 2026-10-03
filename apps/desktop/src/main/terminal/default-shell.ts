/**
 * Picks the shell a new terminal tab launches.
 *
 * POSIX hosts publish the user's login shell in `$SHELL`. Windows has no such
 * convention: `COMSPEC` names cmd.exe, which is the shell of last resort, so
 * PowerShell is preferred when it is installed — pwsh (PowerShell 7) first,
 * then the Windows PowerShell 5.1 that ships with every supported Windows.
 */
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const WINDOWS_SHELL_CANDIDATES = ['pwsh.exe', 'powershell.exe'] as const

function findOnPath(executable: string, env: NodeJS.ProcessEnv): string | null {
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, executable)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function defaultShellPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== 'win32') {
    return env.SHELL || '/bin/zsh'
  }
  for (const executable of WINDOWS_SHELL_CANDIDATES) {
    const found = findOnPath(executable, env)
    if (found) return found
  }
  return env.COMSPEC || 'cmd.exe'
}
