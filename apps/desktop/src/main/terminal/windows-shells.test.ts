import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TerminalRunResult } from '@sim/terminal-protocol'
import { sleep } from '@sim/utils/helpers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalService } from '@/main/terminal'

/**
 * The agent terminal against the real Windows shells: node-pty's ConPTY, the PowerShell and Git
 * Bash integration, and the Windows Stop path, nothing stubbed. Runs only on Windows, and each
 * shell only where it is installed (windows-latest has all three).
 */
const WINDOWS_POWERSHELL = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

interface ShellUnderTest {
  name: string
  path: string
  succeed: string
  fail: string
  /** A cmdlet that fails, which sets no exit code of its own. */
  failingCmdlet?: string
  /** A Windows path as a quoted argument this shell reads. */
  quote(path: string): string
  cd: string
  /** What runs a program named by a quoted path. */
  call: string
}

const POWERSHELL: Omit<ShellUnderTest, 'name' | 'path'> = {
  succeed: 'Write-Output sim-ok',
  fail: 'cmd /c exit 3',
  failingCmdlet: 'Get-Item -LiteralPath C:\\sim-does-not-exist',
  quote: (path) => `'${path}'`,
  cd: 'Set-Location -LiteralPath',
  call: '&',
}

const SHELLS: ShellUnderTest[] = [
  { name: 'PowerShell 7', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', ...POWERSHELL },
  { name: 'Windows PowerShell 5.1', path: WINDOWS_POWERSHELL, ...POWERSHELL },
  {
    name: 'Git Bash',
    path: 'C:\\Program Files\\Git\\bin\\bash.exe',
    succeed: 'echo sim-ok',
    fail: "sh -c 'exit 3'",
    quote: (path) => `'${path.replaceAll('\\', '/')}'`,
    cd: 'cd',
    call: '',
  },
]

/** Ctrl-C reaches this as a keystroke rather than a signal, so it cannot interrupt it. */
const STUBBORN_SCRIPT = `param($PidFile)
[Console]::TreatControlCAsInput = $true
Set-Content -LiteralPath $PidFile -Value $PID
Start-Sleep -Seconds 120
`

/** A shell's first start on a cold CI runner, then the Stop escalation, take a while. */
const SHELL_TEST_TIMEOUT_MS = 90_000

function scratchDirectory(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), 'sim-windows-shell-')))
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function run(
  service: TerminalService,
  toolCallId: string,
  command: string
): Promise<TerminalRunResult> {
  const response = await service.executeTool(toolCallId, 'run', { command, waitSeconds: 60 })
  expect(response).toMatchObject({ ok: true })
  return response.result as TerminalRunResult
}

describe.runIf(process.platform === 'win32')('the agent terminal on Windows', () => {
  let service: TerminalService | null = null

  afterEach(() => {
    service?.dispose()
    service = null
    vi.unstubAllEnvs()
  })

  function open(shell: ShellUnderTest, cwd = scratchDirectory()): TerminalService {
    vi.stubEnv('SHELL', shell.path)
    service = new TerminalService({ loadCwd: () => cwd })
    return service
  }

  describe.each(SHELLS)('$name', (shell) => {
    const installed = existsSync(shell.path)

    it.runIf(installed)(
      "reports a successful command's output and exit code",
      async () => {
        const result = await run(open(shell), 'call-ok', shell.succeed)

        expect(result).toMatchObject({ status: 'completed', exitCode: 0 })
        expect(result.output).toContain('sim-ok')
      },
      SHELL_TEST_TIMEOUT_MS
    )

    it.runIf(installed)(
      "reports a failing program's own exit code",
      async () => {
        const result = await run(open(shell), 'call-fail', shell.fail)

        expect(result).toMatchObject({ status: 'completed', exitCode: 3 })
      },
      SHELL_TEST_TIMEOUT_MS
    )

    it.runIf(installed && shell.failingCmdlet !== undefined)(
      'reports a failing cmdlet as a failure',
      async () => {
        const result = await run(open(shell), 'call-cmdlet', shell.failingCmdlet ?? '')

        expect(result.status).toBe('completed')
        expect(result.exitCode).not.toBe(0)
      },
      SHELL_TEST_TIMEOUT_MS
    )

    it.runIf(installed)(
      'follows the working directory across cd, in Windows form',
      async () => {
        const directory = join(scratchDirectory(), 'my project')
        mkdirSync(directory)

        const result = await run(open(shell), 'call-cd', `${shell.cd} ${shell.quote(directory)}`)

        expect(result.exitCode).toBe(0)
        expect(result.cwd?.toLowerCase()).toBe(directory.toLowerCase())
      },
      SHELL_TEST_TIMEOUT_MS
    )

    it.runIf(installed)(
      'Stop ends a command that ignores Ctrl-C and leaves the shell usable',
      async () => {
        const scratch = scratchDirectory()
        const script = join(scratch, 'stubborn.ps1')
        const pidFile = join(scratch, 'pid')
        writeFileSync(script, STUBBORN_SCRIPT)
        const terminal = open(shell, scratch)
        const command = [
          shell.call,
          shell.quote(WINDOWS_POWERSHELL),
          '-NoProfile -ExecutionPolicy Bypass -File',
          shell.quote(script),
          shell.quote(pidFile),
        ]
          .filter(Boolean)
          .join(' ')

        const running = run(terminal, 'call-stubborn', command)
        await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), {
          timeout: 30_000,
          interval: 100,
        })
        const pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10)
        // Ctrl-C is already a keystroke once the pid is written; this lets Start-Sleep begin.
        await sleep(500)

        await expect(terminal.cancelTool('call-stubborn')).resolves.toBe(true)
        expect(await running).toMatchObject({ status: 'completed' })
        expect(isAlive(pid)).toBe(false)
        expect(await run(terminal, 'call-after', shell.succeed)).toMatchObject({ exitCode: 0 })
      },
      SHELL_TEST_TIMEOUT_MS
    )
  })
})
