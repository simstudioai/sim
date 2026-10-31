import { describe, expect, it } from 'vitest'
import { type WindowsProcess, windowsProcessGroups } from '@/main/terminal/process-group'

const SHELL_PID = 100
const COMMAND_TYPED_AT = 1_000_000

async function foreground(table: WindowsProcess[]): Promise<number[]> {
  const ids = await windowsProcessGroups(async () => table).foreground(SHELL_PID, COMMAND_TYPED_AT)
  return [...ids].sort()
}

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
        { pid: 150, parentPid: SHELL_PID, createdAt: COMMAND_TYPED_AT - 90_000 },
        { pid: 201, parentPid: 150, createdAt: COMMAND_TYPED_AT - 60_000 },
        { pid: 202, parentPid: 150, createdAt: COMMAND_TYPED_AT + 5 },
        { pid: 210, parentPid: 202, createdAt: COMMAND_TYPED_AT + 40 },
      ])
    ).resolves.toEqual([202])
  })
})
