import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  osProcessGroups,
  type WindowsProcess,
  windowsProcessGroups,
} from '@/main/terminal/process-group'

const SHELL_PID = 100
const COMMAND_TYPED_AT = 1_000_000
/** When the pty's shell started, well before the command. */
const SHELL_STARTED_AT = COMMAND_TYPED_AT - 600_000
/** When the shell began running its startup file, after any launcher handed over to it. */
const SHELL_READY_AT = SHELL_STARTED_AT + 500

/** Reads the foreground from `processes`, alongside the shell itself. */
async function foreground(processes: WindowsProcess[] | null): Promise<number[] | null> {
  const table = processes && [
    { pid: SHELL_PID, parentPid: 1, createdAt: SHELL_STARTED_AT },
    ...processes,
  ]
  const ids = await windowsProcessGroups(async () => table).foreground(
    SHELL_PID,
    COMMAND_TYPED_AT,
    SHELL_READY_AT
  )
  return ids && [...ids].sort()
}

describe.skipIf(process.platform === 'win32')('the POSIX foreground process group', () => {
  it('reads a shell that has already exited as idle, not unknown', async () => {
    const child = spawn('true')
    await once(child, 'exit')
    const exitedPid = child.pid
    if (exitedPid === undefined) throw new Error('The child never started')

    await expect(osProcessGroups.foreground(exitedPid, 0, null)).resolves.toEqual([])
  })
})

describe('the Windows foreground command', () => {
  it('is what the shell started since the command was typed, never earlier background work', async () => {
    await expect(
      foreground([
        { pid: 201, parentPid: SHELL_PID, createdAt: COMMAND_TYPED_AT - 60_000 },
        { pid: 202, parentPid: SHELL_PID, createdAt: COMMAND_TYPED_AT },
        { pid: 203, parentPid: SHELL_PID, createdAt: COMMAND_TYPED_AT + 15 },
        { pid: 300, parentPid: 1, createdAt: COMMAND_TYPED_AT + 15 },
      ])
    ).resolves.toEqual([202, 203])
    await expect(
      foreground([{ pid: 201, parentPid: SHELL_PID, createdAt: COMMAND_TYPED_AT - 60_000 }])
    ).resolves.toEqual([])
  })

  it('finds the command behind a launcher, and names only the top of its tree', async () => {
    // Git for Windows' bin\bash.exe holds the pty and starts the real usr\bin\bash.exe.
    await expect(
      foreground([
        { pid: 150, parentPid: SHELL_PID, createdAt: SHELL_STARTED_AT + 30 },
        { pid: 201, parentPid: 150, createdAt: COMMAND_TYPED_AT - 60_000 },
        { pid: 202, parentPid: 150, createdAt: COMMAND_TYPED_AT + 5 },
        { pid: 210, parentPid: 202, createdAt: COMMAND_TYPED_AT + 40 },
      ])
    ).resolves.toEqual([202])
  })

  it('spares a worker that earlier background work starts while the command runs', async () => {
    // pwsh runs a program as its own child; Git Bash forks itself under the real shell for a job.
    // Started the moment the shell was ready, the server is still no launcher.
    await expect(
      foreground([
        { pid: 201, parentPid: SHELL_PID, createdAt: SHELL_READY_AT + 100 },
        { pid: 211, parentPid: 201, createdAt: COMMAND_TYPED_AT + 500 },
        { pid: 202, parentPid: SHELL_PID, createdAt: COMMAND_TYPED_AT + 5 },
      ])
    ).resolves.toEqual([202])
    await expect(
      foreground([
        { pid: 150, parentPid: SHELL_PID, createdAt: SHELL_STARTED_AT + 30 },
        { pid: 201, parentPid: 150, createdAt: SHELL_READY_AT + 100 },
        { pid: 205, parentPid: 201, createdAt: SHELL_READY_AT + 100 },
        { pid: 211, parentPid: 205, createdAt: COMMAND_TYPED_AT + 500 },
        { pid: 202, parentPid: 150, createdAt: COMMAND_TYPED_AT + 5 },
      ])
    ).resolves.toEqual([202])
  })

  it('is unknown, never idle, when the process table cannot be read', async () => {
    await expect(foreground(null)).resolves.toBeNull()
  })
})
