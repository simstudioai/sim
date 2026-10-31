/**
 * Which shell a new terminal runs.
 *
 * macOS and Linux run the user's login shell from `SHELL`. Windows has no such
 * variable of its own, so the terminal picks the best shell installed:
 * PowerShell 7 when it is on PATH, else the Windows PowerShell 5.1 every
 * Windows ships, else cmd.
 */
import { win32 } from 'node:path'

export interface ShellPathContext {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  exists(path: string): boolean
}

/** A Windows path anchored to a drive (`C:\`) or a share (`\\server\share`). */
const WINDOWS_ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/

/** The shell program a new terminal spawns. */
export function resolveShellPath(context: ShellPathContext): string {
  if (context.platform !== 'win32') return context.env.SHELL || '/bin/zsh'
  return configuredWindowsShell(context) ?? defaultWindowsShell(context)
}

/**
 * `SHELL` set to a Windows path, such as Git Bash's `bash.exe`. The MSYS
 * environment exports a POSIX `SHELL` (`/usr/bin/bash`) that nothing outside
 * it can launch, so only a Windows path that exists counts.
 */
function configuredWindowsShell({ env, exists }: ShellPathContext): string | null {
  const shell = env.SHELL
  return shell && WINDOWS_ABSOLUTE_PATH.test(shell) && exists(shell) ? shell : null
}

/** `%SystemRoot%\System32`, named in full so a program on PATH cannot stand in for the system's. */
export function windowsSystem32(env: NodeJS.ProcessEnv): string {
  return win32.join(windowsEnv(env, 'SystemRoot') || 'C:\\Windows', 'System32')
}

/** The Windows PowerShell 5.1 every Windows ships. */
export function windowsPowerShellPath(env: NodeJS.ProcessEnv): string {
  return win32.join(windowsSystem32(env), 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function defaultWindowsShell(context: ShellPathContext): string {
  const windowsPowerShell = windowsPowerShellPath(context.env)
  return (
    findOnPath('pwsh.exe', context) ??
    (context.exists(windowsPowerShell) ? windowsPowerShell : null) ??
    (windowsEnv(context.env, 'ComSpec') || win32.join(windowsSystem32(context.env), 'cmd.exe'))
  )
}

function findOnPath(program: string, { env, exists }: ShellPathContext): string | null {
  for (const entry of (windowsEnv(env, 'Path') ?? '').split(';')) {
    const directory = entry.trim().replace(/^"|"$/g, '')
    if (!WINDOWS_ABSOLUTE_PATH.test(directory)) continue
    const candidate = win32.join(directory, program)
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Reads a Windows environment variable, whose name is case-insensitive. A copy
 * of `process.env` loses the case-insensitive lookup Node gives the original,
 * and Windows itself stores `Path` and `SystemRoot` in mixed case.
 */
function windowsEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const lower = name.toLowerCase()
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === lower)
  return key === undefined ? undefined : env[key]
}
